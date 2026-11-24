import { getStudentData, NotLoggedInError, CANVAS_URL } from "../data/canvas.js";
import { computeParameters, likelihood, phaseFor } from "./model.js";

const DAY = 24 * 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const scoreLevel = (score) => (score >= 0.75 ? "good" : score >= 0.45 ? "warn" : "risk");

function renderOutlook(params) {
  const value = likelihood(params);
  const counted = params.filter((p) => p.weight > 0 && !p.disabled);
  const withData = counted.filter((p) => p.score != null);

  if (value == null) {
    delete $("outlook").dataset.level;
    $("outlook-label").textContent = "Not enough data yet";
    $("outlook-value").textContent = "";
    $("outlook-summary").textContent = "Waiting for Feedpulse and Portflow to sync.";
    return;
  }

  const pct = Math.round(value * 100);
  const level = pct >= 70 ? "good" : pct >= 45 ? "warn" : "risk";
  $("outlook").dataset.level = level;
  $("outlook-label").textContent = { good: "Likely to pass", warn: "Could go either way", risk: "At risk" }[level];
  $("outlook-value").textContent = `${pct}%`;
  // Red (at risk) is on the left, green (likely to pass) on the right.
  $("scale-dot").style.left = `${pct}%`;
  $("scale").setAttribute("aria-label", `Likelihood to pass: ${pct}%`);
  const missing = counted.length - withData.length;
  $("outlook-summary").textContent = missing
    ? `Based on ${withData.length} of ${counted.length} parameters. Sync the rest to make this more accurate.`
    : `Based on all ${counted.length} parameters.`;
}

function renderWeek({ semester }) {
  $("week-label").textContent = `Week ${semester.currentWeek} of ${semester.totalWeeks}`;
  $("phase-name").textContent = `${phaseFor(semester.currentWeek).name} weights`;
  $("week-fill").style.width = `${Math.min(100, (semester.currentWeek / semester.totalWeeks) * 100)}%`;
}

function paramRow(p) {
  const off = p.weight === 0 || p.disabled;
  const level = p.score == null ? "none" : scoreLevel(p.score);
  const right = p.disabled
    ? `<span class="no-data">off</span>`
    : p.score == null
      ? `<span class="no-data">no data</span>`
      : `<div class="bar" title="Score ${Math.round(p.score * 100)}%"><div style="width:${Math.round(p.score * 100)}%"></div></div>`;
  const weight = off ? "–" : `×${p.weight}`;
  const weightTitle = p.disabled ? "Turned off" : off ? "Not counted in this part of the semester" : `Weight ${p.weight} in this part of the semester`;
  const toggle = p.toggle
    ? `<label class="switch" title="Count ${esc(p.label.toLowerCase())}">
         <input type="checkbox" data-setting="${esc(p.toggle.key)}" ${p.toggle.on ? "checked" : ""} aria-label="Count ${esc(p.label.toLowerCase())}">
         <span></span>
       </label>`
    : "";
  const inner = `
    <div>
      <div class="param-label">${esc(p.label)}</div>
      <div class="param-value">${esc(p.value)}</div>
    </div>
    <div class="param-right">
      ${toggle}
      <span class="weight" title="${esc(weightTitle)}">${weight}</span>
      ${right}
    </div>`;

  if (!p.details?.length) {
    return `<div class="param${off ? " off" : ""}${p.toggle ? " has-toggle" : ""}" data-level="${level}">${inner}</div>`;
  }
  const sub = p.details
    .map((d) => `<li data-level="${scoreLevel(d.score)}"><span>${esc(d.label)}</span><span>${esc(d.value)}</span></li>`)
    .join("");
  return `<details class="param-details">
      <summary class="param${off ? " off" : ""}" data-level="${level}">${inner}</summary>
      <ul class="sub-list">${sub}</ul>
    </details>`;
}

function feedpulseMailto(student) {
  if (!student?.email) return "";
  const body = `Hey ${student.firstName || "there"}, maybe you should go for a FeedPulse again?`;
  const href = `mailto:${student.email}?subject=${encodeURIComponent("FeedPulse")}&body=${encodeURIComponent(body)}`;
  return `<a class="mini-btn" id="mail-feedpulse" href="${esc(href)}" title="Email ${esc(student.email)}">✉ Remind</a>`;
}

function graceSelect(settings) {
  const current = Number(settings.graceDays) || 0;
  const options = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((d) => `<option value="${d}" ${d === current ? "selected" : ""}>${d}</option>`)
    .join("");
  return `<label class="grace" title="Days a hand-in may be late and still count as on time">
      Grace <select data-setting="graceDays" aria-label="Grace days after the deadline">${options}</select>
      ${current === 1 ? "day" : "days"}
    </label>`;
}

function renderParams(params, data, settings) {
  const groups = [...new Set([...params.map((p) => p.group), "Assignments"])];
  const controls = { Feedpulse: feedpulseMailto(data.student), Assignments: graceSelect(settings) };
  $("params").innerHTML = groups
    .map((g) => {
      const items = params.filter((p) => p.group === g);
      const control = controls[g] ?? "";
      const showName = control || items.length !== 1 || items[0].label !== g;
      const name = showName ? `<div class="group-name"><span>${esc(g)}</span>${control}</div>` : "";
      const rows = items.length ? items.map(paramRow).join("") : `<div class="param empty">Nothing handed in yet</div>`;
      return `<div class="group">${name}${rows}</div>`;
    })
    .join("");
}

function renderSynced(data) {
  if (syncing && autoSyncOn()) {
    $("synced").textContent = "Syncing Feedpulse and Portflow…";
    return;
  }
  const ago = (iso) => {
    if (!iso) return "not synced";
    const days = Math.floor((Date.now() - new Date(iso)) / DAY);
    return days === 0 ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `${days}d ago`;
  };
  $("synced").textContent =
    `Canvas ${ago(data.syncedAt)} · Feedpulse ${ago(data.feedpulse?.syncedAt)} · Portflow ${ago(data.portflow?.evidenceSyncedAt ?? data.portflow?.syncedAt)}` +
    (autoSyncOn() ? "" : " · auto-sync off");
}

function renderError(err) {
  document.body.classList.add("no-data");
  delete $("outlook").dataset.level;
  $("outlook-value").textContent = "";
  if (err instanceof NotLoggedInError) {
    $("outlook-label").textContent = "Log in to Canvas";
    $("outlook-summary").innerHTML = `Open <a href="${CANVAS_URL}" target="_blank" rel="noopener">Canvas</a>, log in, then reopen this popup.`;
  } else {
    $("outlook-label").textContent = "Couldn't load Canvas";
    $("outlook-summary").textContent = err.message;
  }
}

// ---------- Settings (e.g. attendance on/off), kept between popups ----------

const storage = globalThis.chrome?.storage?.local;

async function loadSettings() {
  if (storage) return (await storage.get("settings")).settings ?? {};
  try { return JSON.parse(localStorage.getItem("dropout-radar-settings")) ?? {}; } catch { return {}; }
}

async function saveSettings(settings) {
  if (storage) await storage.set({ settings });
  else localStorage.setItem("dropout-radar-settings", JSON.stringify(settings));
}

// ---------- Boot ----------

let settings = {};
let current = null; // { data, settings }
let syncing = false;

const autoSyncOn = () => settings.autoSync !== false;

async function updateSettings(patch) {
  settings = { ...settings, ...patch };
  if (current) current.settings = settings;
  await saveSettings(settings);
}

// Ask background.js to refresh Feedpulse + Portflow (only when stale, unless
// forced). Never when the student switched automatic sync off.
async function requestSync(force) {
  if (!autoSyncOn() || !globalThis.chrome?.runtime?.sendMessage) return;
  const status = await chrome.runtime.sendMessage({ type: "dr-sync", force }).catch(() => null);
  syncing = Boolean(status?.started || status?.running);
  if (current) renderSynced(current.data);
}

// Re-render as soon as the background sync stores (or deletion removes) data.
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || !current) return;
  if (changes.feedpulse) current.data.feedpulse = changes.feedpulse.newValue ?? null;
  if (changes.portflow) current.data.portflow = changes.portflow.newValue ?? null;
  if (changes.syncStatus) syncing = Boolean(changes.syncStatus.newValue?.running);
  if (changes.feedpulse || changes.portflow || changes.syncStatus) render();
});

// ---------- Privacy panel ----------

function renderPrivacy() {
  $("auto-sync").checked = autoSyncOn();
  const fp = current?.data.feedpulse?.syncedAt;
  const pf = current?.data.portflow?.syncedAt;
  const when = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const parts = [fp && `Feedpulse summary from ${when(fp)}`, pf && `Portflow summary from ${when(pf)}`].filter(Boolean);
  $("privacy-status").textContent = parts.length ? `Stored now: ${parts.join(", ")}.` : "No Feedpulse or Portflow data stored.";
}

$("privacy-btn").addEventListener("click", () => {
  const panel = $("privacy");
  panel.open = !panel.open;
  if (panel.open) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

$("auto-sync").addEventListener("change", async (e) => {
  await updateSettings({ autoSync: e.target.checked });
  if (current) render();
  if (e.target.checked) requestSync(false);
});

// Two-step delete: first click asks for confirmation, second click deletes.
let confirmTimer;
$("delete-data").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains("confirm")) {
    btn.classList.add("confirm");
    btn.textContent = "Sure?";
    confirmTimer = setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = "Delete"; }, 4000);
    return;
  }
  clearTimeout(confirmTimer);
  if (storage) await storage.remove(["feedpulse", "portflow", "syncStatus"]);
  if (current) {
    current.data.feedpulse = null;
    current.data.portflow = null;
    render();
  }
  btn.classList.remove("confirm");
  btn.textContent = "Deleted";
  btn.disabled = true;
  setTimeout(() => { btn.textContent = "Delete"; btn.disabled = false; }, 2000);
});

// ---------- Rendering + loading ----------

function render() {
  const params = computeParameters(current.data, current.settings);
  renderOutlook(params);
  renderWeek(current.data);
  renderParams(params, current.data, current.settings);
  renderSynced(current.data);
  renderPrivacy();
}

async function load(forceSync = false) {
  $("outlook-label").textContent = "Loading…";
  $("outlook-summary").textContent = "Reading your Canvas data";
  settings = await loadSettings();
  renderPrivacy();
  try {
    const data = await getStudentData();
    document.body.classList.remove("no-data");
    current = { data, settings };
    render();
    requestSync(forceSync);
  } catch (err) {
    console.error(err);
    renderError(err);
  }
}

$("params").addEventListener("change", async (e) => {
  const key = e.target.dataset?.setting;
  if (!key || !current) return;
  const value = e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
  await updateSettings({ [key]: value });
  render();
});

// mailto links from an extension popup are handed to the mail app via a tab.
$("params").addEventListener("click", (e) => {
  const link = e.target.closest?.("#mail-feedpulse");
  if (!link || !globalThis.chrome?.tabs?.create) return;
  e.preventDefault();
  chrome.tabs.create({ url: link.href });
});

$("canvas-link").href = CANVAS_URL;
$("refresh").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  btn.classList.remove("spinning");
  void btn.offsetWidth;
  btn.classList.add("spinning");
  load(true);
});
load();
