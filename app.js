console.log("LunchVote App v1.0.3 - Explicit Window Binding");
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, deleteDoc, onSnapshot,
  initializeFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Firebase Config ───────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAh0RW7uzyudhU1mfKA8Y02I2isp8jnm_s",
  authDomain: "officelunchvote.firebaseapp.com",
  projectId: "officelunchvote",
  storageBucket: "officelunchvote.firebasestorage.app",
  messagingSenderId: "223491870090",
  appId: "1:223491870090:web:e419175e6827e16df58c73",
  measurementId: "G-L7LQWN2ETR"
};

const ADMIN_ID = "SEEIN00024";

const app = initializeApp(firebaseConfig);
const db  = initializeFirestore(app, { experimentalForceLongPolling: true });

// ── App state ─────────────────────────────────────
let currentUser = null;
let weekId      = "";
let weekDays    = [];
let myVotes     = {};
let liveUnsub   = null;
let votingSettings = { mode: "auto", manualStatus: "open", activeWeekMonday: "" };

// ════════════════════════════════════════════════
//  WEEK HELPERS
// ════════════════════════════════════════════════

function getNextWeekMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hour = now.getHours();

  // Find the closest upcoming Monday
  let daysToNextMon = (day === 0) ? 1 : (8 - day);
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + daysToNextMon);

  // Transition logic: if past Friday 6 PM, we vote for the following week
  const isPastFriday6PM = (day === 5 && hour >= 18) || (day === 6) || (day === 0);
  if (isPastFriday6PM) {
    nextMon.setDate(nextMon.getDate() + 7);
  }

  nextMon.setHours(0, 0, 0, 0);
  return nextMon;
}

function getWeekId(monday) {
  const d    = new Date(monday);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w    = Math.ceil((((d - jan4) / 86400000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, "0")}`;
}

function getWeekDays(monday) {
  const dayNames = ["Mon","Tue","Wed","Thu","Fri"];
  const months   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return dayNames.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${name} ${d.getDate()} ${months[d.getMonth()]}`;
  });
}

function formatDateToLabel(d) {
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${dayNames[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function getMondayOfDate(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function getYMD(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMondayOfISOWeek(w, y) {
  const simple = new Date(y, 0, 1 + (w - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4)
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  else
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  return ISOweekStart;
}

async function isVotingOpen() {
  if (votingSettings.mode === "manual") {
    return votingSettings.manualStatus === "open";
  }
  // Auto mode: voting is always open for "some" week.
  // The transition happens at Friday 6 PM via getNextWeekMonday.
  return true;
}

function formatTimestamp(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════

window.showScreen = function(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};

window.toast = function(msg, type = "ok") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = "", 3000);
};

// ════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════

window.doLogin = async function() {
  const empId = document.getElementById("loginEmpId").value.trim().toUpperCase();
  const pass  = document.getElementById("loginPass").value.trim().toUpperCase();

  if (!empId || !pass) return toast("Please enter your Employee ID", "error");
  if (empId !== pass)  return toast("Password must match your Employee ID", "error");

  document.getElementById("loginLoading").style.display = "block";

  try {
    // Admin login — auto-creates admin record on first login
    if (empId === ADMIN_ID) {
      const adminDoc = await getDoc(doc(db, "admins", ADMIN_ID));
      if (!adminDoc.exists()) {
        await setDoc(doc(db, "admins", ADMIN_ID), {
          password: ADMIN_ID, createdAt: new Date().toISOString()
        });
      }
      currentUser = { id: ADMIN_ID, isAdmin: true };
      afterLogin();
      return;
    }

    // Employee login
    const empDoc = await getDoc(doc(db, "employees", empId));
    if (empDoc.exists()) {
      currentUser = { id: empId, isAdmin: false };
      afterLogin();
      return;
    }

    toast("Employee ID not found. Contact HR.", "error");
  } catch (e) {
    toast(`Error: ${e.code || e.message || "Unknown error"}`, "error");
    console.error(e);
  } finally {
    document.getElementById("loginLoading").style.display = "none";
  }
};

async function afterLogin() {
  document.getElementById("badgeId").textContent = currentUser.id;
  document.getElementById("userBadge").style.display = "flex";

  // Load settings first to know which week to show
  await loadVotingSettings();

  let targetMon;
  if (votingSettings.mode === "manual" && votingSettings.activeWeekMonday) {
    targetMon = new Date(votingSettings.activeWeekMonday);
  } else {
    targetMon = getNextWeekMonday();
  }

  weekId   = getWeekId(targetMon);
  weekDays = getWeekDays(targetMon);

  if (currentUser.isAdmin) {
    showScreen("adminScreen");
    const empTab = document.querySelector('.tab[onclick*="employees"]');
    if (empTab) showAdminTab('employees', empTab);
    loadAdminEmployees();
    loadVotingSettings();
    
    // Default range: current week Mon-Fri
    const mon = getMondayOfDate(new Date());
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    
    document.getElementById("adminFromDate").value = mon.toISOString().split("T")[0];
    document.getElementById("adminToDate").value   = fri.toISOString().split("T")[0];
    
    loadAdminTally();
  } else {
    showScreen("voteScreen");
    await renderVoteScreen();
    subscribeToTally();
  }
}

document.getElementById("logoutBtn").onclick = function() {
  currentUser = null;
  if (liveUnsub) liveUnsub();
  document.getElementById("userBadge").style.display = "none";
  document.getElementById("loginEmpId").value = "";
  document.getElementById("loginPass").value  = "";
  showScreen("loginScreen");
};

// ════════════════════════════════════════════════
//  VOTE SCREEN
// ════════════════════════════════════════════════

async function renderVoteScreen() {
  const open  = await isVotingOpen();
  const badge = document.getElementById("deadlineBadge");
  badge.innerHTML = open
    ? `<div class="deadline-badge open"><div class="dot"></div>Voting open – next week starts Friday 6 PM</div>`
    : `<div class="deadline-badge closed"><div class="dot"></div>Voting closed</div>`;

  if (votingSettings.mode === "manual") {
    badge.innerHTML = votingSettings.manualStatus === "open"
      ? `<div class="deadline-badge open"><div class="dot"></div>Voting open (Manual Override)</div>`
      : `<div class="deadline-badge closed"><div class="dot"></div>Voting closed (Manual Override)</div>`;
  }

  document.getElementById("weekLabel").textContent =
    "Next week: " + weekDays[0] + " → " + weekDays[4];

  await renderCurrentWeekStatus();

  const voteDoc = await getDoc(doc(db, "votes", weekId, "byUser", currentUser.id));
  myVotes = voteDoc.exists() ? (voteDoc.data().days || {}) : {};
  await renderDaysList(open);
}

async function renderCurrentWeekStatus() {
  const container = document.getElementById("currentWeekStatus");
  
  // Current week Mon-Fri
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(now.setDate(diff));
  
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d);
  }
  
  const snap = await getDocs(collection(db, "foodStatus"));
  const availMap = {};
  snap.forEach(doc => availMap[doc.id] = doc.data().available);
  
  const confirmedDays = [];
  days.forEach(d => {
    if (availMap[getYMD(d)]) {
      const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
      confirmedDays.push(dayName);
    }
  });

  if (confirmedDays.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="card" style="background:var(--teallt); border-color:var(--teal); padding:16px; animation: none;">
      <div style="display:flex; align-items:center; gap:10px">
        <span style="font-size:20px">🍱</span>
        <div>
          <div style="font-size:12px; font-weight:800; color:var(--teal)">LUNCH STATUS — THIS WEEK</div>
          <div style="font-size:13px; font-weight:600; color:var(--text2); margin-top:2px">
            Lunch is confirmed for: <b>${confirmedDays.join(", ")}</b>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderDaysList(open) {
  const availabilitySnap = await getDocs(collection(db, "foodStatus"));
  const availMap = {};
  availabilitySnap.forEach(doc => availMap[doc.id] = doc.data());

  document.getElementById("daysList").innerHTML = weekDays.map((d, i) => {
    const dateObj = new Date(getNextWeekMonday());
    dateObj.setDate(dateObj.getDate() + i);
    const ymd = getYMD(dateObj);
    const status = availMap[ymd] || {};
    const isAvail = status.available || false;
    const isHoliday = status.isHoliday || false;

    if (isHoliday) {
      return `
      <div class="day-row holiday-row" id="row-${btoa(d)}">
        <div class="day-check">✕</div>
        <div class="day-label">
          ${d}
          <span class="holiday-badge">● HOLIDAY / WFH</span>
        </div>
      </div>
    `;
    }

    return `
    <div class="day-row ${myVotes[d] ? "selected" : ""}" id="row-${btoa(d)}"
         onclick="${open ? `toggleDay('${d}')` : ""}">
      <div class="day-check">${myVotes[d] ? "✓" : ""}</div>
      <div class="day-label">
        ${d}
        ${isAvail 
          ? `<span class="confirmed-badge">● FOOD CONFIRMED</span>`
          : ""}
      </div>
    </div>
  `;}).join("");
  document.getElementById("submitVoteBtn").disabled = !open;
}

window.toggleDay = function(day) {
  myVotes[day] = !myVotes[day];
  const row = document.getElementById("row-" + btoa(day));
  row.classList.toggle("selected", myVotes[day]);
  row.querySelector(".day-check").textContent = myVotes[day] ? "✓" : "";
};

window.submitVote = async function() {
  const btn = document.getElementById("submitVoteBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await setDoc(doc(db, "votes", weekId, "byUser", currentUser.id), {
      empId: currentUser.id, days: myVotes, updatedAt: new Date().toISOString()
    });
    toast("✓ Votes saved!", "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
  btn.disabled = false;
  btn.textContent = "Save my choices";
};

function subscribeToTally() {
  liveUnsub = onSnapshot(collection(db, "votes", weekId, "byUser"), async (snap) => {
    const counts = {};
    weekDays.forEach(d => counts[d] = 0);
    snap.forEach(ds => {
      const days = ds.data().days || {};
      weekDays.forEach(d => { if (days[d]) counts[d]++; });
    });
    await renderSummaryTable(counts, "tallyTable");
  });
}

// ════════════════════════════════════════════════
//  SUMMARY TABLE
// ════════════════════════════════════════════════

async function renderSummaryTable(counts, tableId) {
  const availabilitySnap = await getDocs(collection(db, "foodStatus"));
  const availMap = {};
  availabilitySnap.forEach(doc => availMap[doc.id] = doc.data());

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  document.getElementById(tableId).innerHTML = `
    <table class="summary-table">
      <thead>
        <tr><th>Day</th><th>Date</th><th style="text-align:right">Headcount</th></tr>
      </thead>
      <tbody>
        ${weekDays.map((d, i) => {
          const [day, date, mon] = d.split(" ");
          
          const dateObj = new Date(getNextWeekMonday());
          dateObj.setDate(dateObj.getDate() + i);
          const ymd = getYMD(dateObj);
          const status = availMap[ymd] || {};
          const isHoliday = status.isHoliday || false;

          return `<tr>
            <td>
              <strong>${day}</strong>
              ${isHoliday ? `<span class="holiday-badge" style="margin-left:5px; font-size:8px; padding:1px 5px">H/WFH</span>` : ""}
            </td>
            <td style="color:var(--muted)">${date} ${mon}</td>
            <td style="text-align:right">
              <span class="count-pill ${isHoliday ? "zero" : ""}">${isHoliday ? "—" : counts[d] + " pax"}</span>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="total-bar" style="display:flex; justify-content:space-between; align-items:center; padding:12px 0 4px; border-top:1.5px solid var(--border); margin-top:8px">
      <span style="color:var(--muted);font-size:12px">Total lunch orders this week</span>
      <span class="total-num" style="font-size:20px">${total}</span>
    </div>`;
}

function renderSummaryTableForAdmin(counts, tableId, days, availability = {}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  document.getElementById(tableId).innerHTML = `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Date</th>
          <th style="text-align:right">Pax</th>
          <th style="text-align:right">Food?</th>
          <th style="text-align:right">H/WFH?</th>
        </tr>
      </thead>
      <tbody>
        ${days.map(d => {
          const [day, date, mon] = d.split(" ");
          const status = availability[d] || {};
          const isAvailable = status.available || false;
          const isHoliday = status.isHoliday || false;
          return `<tr>
            <td><strong>${day}</strong></td>
            <td style="color:var(--muted)">${date} ${mon}</td>
            <td style="text-align:right"><span class="count-pill">${counts[d]}</span></td>
            <td style="text-align:right">
              <input type="checkbox" class="food-toggle" data-day="${d}" ${isAvailable ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
            </td>
            <td style="text-align:right">
              <input type="checkbox" class="holiday-toggle" data-day="${d}" ${isHoliday ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="total-footer">
      <div class="total-label">Total lunch orders</div>
      <div class="total-num">${total}</div>
    </div>
    <div style="margin-top:20px; text-align:right">
       <button class="btn btn-primary" onclick="saveAvailability(event)" style="width:auto; padding:10px 24px">
         ✓ Save Food Status
       </button>
    </div>`;
}

// ════════════════════════════════════════════════
//  ADMIN — EMPLOYEES TAB
// ════════════════════════════════════════════════

window.addEmployee = async function() {
  const empId = document.getElementById("empId").value.trim().toUpperCase();
  if (!empId) return toast("Enter an Employee ID", "error");
  if (empId === ADMIN_ID) return toast("Admin ID cannot be added as employee", "error");

  const existing = await getDoc(doc(db, "employees", empId));
  if (existing.exists()) return toast(`${empId} already exists — duplicate not allowed`, "error");

  try {
    await setDoc(doc(db, "employees", empId), {
      empId, password: empId, createdAt: new Date().toISOString()
    });
    toast(`✓ ${empId} added successfully`, "ok");
    document.getElementById("empId").value = "";
    loadAdminEmployees();
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

async function loadAdminEmployees() {
  const snap = await getDocs(collection(db, "employees"));
  document.getElementById("empCountSub").textContent = snap.empty
    ? "No employees added yet"
    : `${snap.size} employee${snap.size !== 1 ? "s" : ""} registered`;

  if (snap.empty) {
    document.getElementById("empList").innerHTML =
      `<p style="color:var(--muted);font-size:12px;padding:10px 0">No employees yet.</p>`;
    return;
  }

  const sorted = snap.docs.slice().sort((a, b) => a.id.localeCompare(b.id));
  document.getElementById("empList").innerHTML = `
    <table class="emp-table">
      <thead><tr><th>#</th><th>Employee ID</th><th>Added on</th><th></th></tr></thead>
      <tbody>
        ${sorted.map((d, i) => `
          <tr>
            <td style="color:var(--muted2);font-size:11px">${i + 1}</td>
            <td><span class="emp-id-tag">${d.id}</span></td>
            <td class="timestamp-tag">${formatTimestamp(d.data().createdAt)}</td>
            <td style="text-align:right">
              <button class="remove-btn" onclick="removeEmployee('${d.id}')">✕</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

window.removeEmployee = async function(empId) {
  if (!confirm(`Remove employee ${empId}?`)) return;
  await deleteDoc(doc(db, "employees", empId));
  toast(`${empId} removed`, "ok");
  loadAdminEmployees();
};

// ════════════════════════════════════════════════
//  BULK UPLOAD — Employee ID list (one per line)
//  Example CSV:
//    SEEIN00001
//    SEEIN00002
//    SEEIN00003
// ════════════════════════════════════════════════

window.handleCSVUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const lines = e.target.result
      .split("\n")
      .map(l => l.trim().toUpperCase())
      .filter(l => l.length > 0 && l !== ADMIN_ID);

    // Skip header row if present
    const firstLower = lines[0].toLowerCase();
    const dataLines  = (firstLower.includes("emp") && !firstLower.match(/^[A-Z0-9]+$/))
                       ? lines.slice(1) : lines;

    // Deduplicate within file
    const unique = [...new Set(dataLines)];

    const preview = document.getElementById("csvPreview");
    preview.style.display = "block";
    preview.innerHTML =
      `<strong>${unique.length} unique Employee IDs found:</strong><br>` +
      unique.slice(0, 8).join(" · ") +
      (unique.length > 8 ? ` · ... and ${unique.length - 8} more` : "");

    const btn = document.getElementById("confirmUploadBtn");
    btn.style.display = "block";
    btn.disabled = false;
    btn.textContent = `Upload ${unique.length} Employees`;
    btn.onclick = () => bulkUpload(unique);
  };
  reader.readAsText(file);
};

async function bulkUpload(ids) {
  const btn = document.getElementById("confirmUploadBtn");
  btn.disabled = true;
  btn.textContent = "Uploading…";

  let added = 0, skipped = 0, failed = 0;
  for (const empId of ids) {
    if (!empId) continue;
    try {
      const existing = await getDoc(doc(db, "employees", empId));
      if (existing.exists()) { skipped++; continue; }
      await setDoc(doc(db, "employees", empId), {
        empId, password: empId, createdAt: new Date().toISOString()
      });
      added++;
    } catch { failed++; }
  }

  toast(
    `✓ ${added} added` +
    (skipped > 0 ? `, ${skipped} already existed (skipped)` : "") +
    (failed  > 0 ? `, ${failed} failed` : ""),
    "ok"
  );

  btn.style.display = "none";
  document.getElementById("csvPreview").style.display = "none";
  document.getElementById("csvFileInput").value = "";
  loadAdminEmployees();
}

// ════════════════════════════════════════════════
//  ADMIN — RESULTS TAB
// ════════════════════════════════════════════════

window.loadAdminTally = loadAdminTally;
async function loadAdminTally() {
  const fromEl = document.getElementById("adminFromDate");
  const toEl   = document.getElementById("adminToDate");
  
  if (!fromEl || !toEl || !fromEl.value || !toEl.value) return;
  
  const fromDate = new Date(fromEl.value);
  const toDate   = new Date(toEl.value);
  fromDate.setHours(0,0,0,0);
  toDate.setHours(23,59,59,999);

  if (fromDate > toDate) return toast("From date cannot be after To date", "error");

  const labelText = `Results for: ${fromDate.toLocaleDateString("en-IN", {day:"2-digit", month:"short"})} to ${toDate.toLocaleDateString("en-IN", {day:"2-digit", month:"short"})}`;
  document.getElementById("adminWeekLabel").textContent = labelText;
  
  // Update card subtexts to match selection
  document.querySelectorAll("#tab-results .card-sub").forEach(el => {
    el.textContent = `Headcount data for the period ${fromDate.toLocaleDateString()} to ${toDate.toLocaleDateString()}`;
  });

  console.log("Fetching results for range:", fromEl.value, "to", toEl.value);

  // Get all days in range
  const daysInRange = [];
  let curr = new Date(fromDate);
  while (curr <= toDate) {
    daysInRange.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }

  // Identify unique weeks to fetch
  const weeksToFetch = [...new Set(daysInRange.map(d => getWeekId(getMondayOfDate(d))))];
  console.log("Weeks to query:", weeksToFetch);
  
  const allVotes = [];
  for (const wkId of weeksToFetch) {
    try {
      const snap = await getDocs(collection(db, "votes", wkId, "byUser"));
      console.log(`Fetched ${snap.size} votes for ${wkId}`);
      snap.forEach(ds => allVotes.push({ weekId: wkId, ...ds.data() }));
    } catch (e) {
      console.error(`Error fetching week ${wkId}:`, e);
    }
  }

  const counts = {};
  const labels = daysInRange.map(d => formatDateToLabel(d));
  labels.forEach(l => counts[l] = 0);

  const votersMap = {};

  allVotes.forEach(v => {
    const empId = v.empId;
    if (!votersMap[empId]) votersMap[empId] = { empId, days: [], updatedAt: v.updatedAt };
    
    const days = v.days || {};
    console.log(`Checking vote for ${empId} in week ${v.weekId}:`, days);
    daysInRange.forEach(d => {
      const wkIdForD = getWeekId(getMondayOfDate(d));
      const label = formatDateToLabel(d);
      if (wkIdForD === v.weekId) {
        console.log(`  Matching day ${label} against week ${v.weekId}`);
        if (days[label]) {
          counts[label]++;
          if (!votersMap[empId].days.includes(label)) votersMap[empId].days.push(label);
        }
      }
    });
  });

  const voters = Object.values(votersMap).sort((a,b) => a.empId.localeCompare(b.empId));
  
  // Fetch current availability for these days
  const availSnap = await getDocs(collection(db, "foodStatus"));
  const availMap = {};
  availSnap.forEach(doc => availMap[doc.id] = doc.data());
  
  const currentAvailability = {};
  daysInRange.forEach(d => {
    const ymd = getYMD(d);
    currentAvailability[formatDateToLabel(d)] = availMap[ymd] || {};
  });

  renderSummaryTableForAdmin(counts, "adminTallyTable", labels, currentAvailability);
  
  const vl = document.getElementById("adminVoterList");
  if (voters.length === 0) {
    vl.innerHTML = `<div class="empty-state">
      <span class="empty-icon">📭</span>
      No votes found for this period.
    </div>`;
    return;
  }

  vl.innerHTML = `
    <table class="voter-table">
      <thead>
        <tr>
          <th>Employee ID</th>
          <th>Days opted</th>
          <th style="text-align:right">Last Updated</th>
        </tr>
      </thead>
      <tbody>
        ${voters.map(v => `
          <tr>
            <td><span class="id-tag">${v.empId}</span></td>
            <td class="days-tag">
              ${v.days.length > 0
                ? v.days.map(d => d.split(" ")[0]).join(" · ")
                : "<span style='color:var(--muted2)'>None selected</span>"}
            </td>
            <td style="text-align:right" class="ts-tag">${formatTimestamp(v.updatedAt)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

window.showAdminTab = function(tab, el) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("tab-employees").style.display = tab === "employees" ? "block" : "none";
  document.getElementById("tab-results").style.display   = tab === "results"   ? "block" : "none";
  document.getElementById("tab-settings").style.display  = tab === "settings"  ? "block" : "none";
  if (tab === "results") loadAdminTally();
  if (tab === "settings") loadVotingSettings();
};

window.saveAvailability = async function(event) {
  const btn = event.currentTarget || event.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving...";

  const foodToggles = document.querySelectorAll(".food-toggle");
  const holidayToggles = document.querySelectorAll(".holiday-toggle");
  
  try {
    for (let i = 0; i < foodToggles.length; i++) {
      const label = foodToggles[i].dataset.day;
      const isAvailable = foodToggles[i].checked;
      const isHoliday = holidayToggles[i].checked;
      
      const fromEl = document.getElementById("adminFromDate");
      const toEl   = document.getElementById("adminToDate");
      let curr = new Date(fromEl.value);
      curr.setHours(0,0,0,0);
      const to   = new Date(toEl.value);
      to.setHours(23,59,59,999);
      
      while (curr <= to) {
        if (formatDateToLabel(curr) === label) {
          const ymd = getYMD(curr);
          await setDoc(doc(db, "foodStatus", ymd), { 
            available: isAvailable,
            isHoliday: isHoliday
          });
          break;
        }
        curr.setDate(curr.getDate() + 1);
      }
    }
    toast("✓ Food status updated successfully!", "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ════════════════════════════════════════════════
//  ADMIN — SETTINGS
// ════════════════════════════════════════════════

window.loadVotingSettings = async function() {
  try {
    const docSnap = await getDoc(doc(db, "settings", "voting"));
    if (docSnap.exists()) {
      votingSettings = docSnap.data();
    }
    
    // Update Admin UI if visible
    const modeRadios = document.getElementsByName("votingMode");
    if (modeRadios.length > 0) {
      modeRadios.forEach(r => r.checked = (r.value === votingSettings.mode));
      
      const monInput = document.getElementById("activeWeekMon");
      if (monInput) monInput.value = votingSettings.activeWeekMonday || "";
      
      updateVotingModeUI();
      updateManualStatusButtons();
    }
  } catch (e) {
    console.error("Error loading settings:", e);
  }
};

window.updateVotingModeUI = function() {
  const modeRadios = document.getElementsByName("votingMode");
  let mode = "auto";
  modeRadios.forEach(r => { if(r.checked) mode = r.value; });
  
  const manualControls = document.getElementById("manualControls");
  if (manualControls) manualControls.style.display = (mode === "manual" ? "block" : "none");
  
  // If auto, maybe show current auto-week as hint?
  if (mode === "auto") {
    const nextMon = getNextWeekMonday();
    const monInput = document.getElementById("activeWeekMon");
    if (monInput && !monInput.value) monInput.value = getYMD(nextMon);
  }
};

window.setManualStatus = function(status) {
  votingSettings.manualStatus = status;
  updateManualStatusButtons();
  toast(`Status set to ${status.toUpperCase()} locally. Click "Save Settings" to apply.`, "ok");
};

function updateManualStatusButtons() {
  const openBtn = document.getElementById("manualOpenBtn");
  const closeBtn = document.getElementById("manualCloseBtn");
  if (!openBtn || !closeBtn) return;

  if (votingSettings.manualStatus === "open") {
    openBtn.className = "btn btn-primary";
    closeBtn.className = "btn btn-ghost";
    closeBtn.style.background = "";
    closeBtn.style.color = "";
  } else {
    openBtn.className = "btn btn-ghost";
    closeBtn.className = "btn btn-red";
    closeBtn.style.background = "var(--red)";
    closeBtn.style.color = "white";
  }
}

window.saveVotingSettings = async function() {
  const modeRadios = document.getElementsByName("votingMode");
  let mode = "auto";
  modeRadios.forEach(r => { if(r.checked) mode = r.value; });
  
  const monInput = document.getElementById("activeWeekMon");
  const selectedMon = monInput ? monInput.value : "";
  
  if (mode === "manual" && !selectedMon) {
    return toast("Please select a target Monday for manual mode", "error");
  }

  votingSettings.mode = mode;
  votingSettings.activeWeekMonday = selectedMon;
  
  try {
    await setDoc(doc(db, "settings", "voting"), votingSettings);
    toast("✓ Settings saved successfully!", "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};
