// Keeps Feedpulse and Portflow data fresh without the student opening them.
// Both tools only work inside Canvas (their logins live in the Canvas iframe),
// so we open their Canvas pages in a minimized window, let the content scripts
// read them, and close the window again.

import { api, currentCourses, CANVAS_URL } from "./data/canvas.js";

const STALE_MS = 6 * 60 * 60 * 1000; // re-sync when data is older than this
const TIMEOUT_MS = 45 * 1000; // give up and close the window after this
const SETTLE_MS = 2500; // keep the page open a bit after the first save
// Portflow is a global-navigation tool on Fontys ICT Canvas ("Portfolio" in the left menu).
const PORTFLOW_PATH = "/accounts/1/external_tools/23360?launch_type=global_navigation";

let running = null;

const isStale = (iso) => !iso || Date.now() - new Date(iso) > STALE_MS;
const newer = (iso, than) => Boolean(iso) && iso > than;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findFeedpulseUrl() {
  for (const course of await currentCourses()) {
    const tabs = await api(`/api/v1/courses/${course.id}/tabs`).catch(() => []);
    const tab = tabs.find((t) => t.type === "external" && /feedpulse/i.test(t.label));
    if (tab) return new URL(tab.html_url, CANVAS_URL).href;
  }
  return null;
}

async function waitUntilSynced(startedAt, wantFeedpulse, wantPortflow) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { feedpulse, portflow } = await chrome.storage.local.get(["feedpulse", "portflow"]);
    const fpDone = !wantFeedpulse || newer(feedpulse?.syncedAt, startedAt);
    const pfDone = !wantPortflow ||
      (newer(portflow?.evidenceSyncedAt, startedAt) && newer(portflow?.goalsSyncedAt, startedAt));
    if (fpDone && pfDone) {
      await sleep(SETTLE_MS); // let late-rendering content be picked up too
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function runSync(wantFeedpulse, wantPortflow) {
  const urls = [];
  const feedpulseUrl = wantFeedpulse ? await findFeedpulseUrl().catch(() => null) : null;
  if (feedpulseUrl) urls.push(feedpulseUrl);
  if (wantPortflow) urls.push(CANVAS_URL + PORTFLOW_PATH);
  if (!urls.length) return;

  const startedAt = new Date().toISOString();
  await chrome.storage.local.set({ syncStatus: { running: true, startedAt } });
  let win;
  try {
    win = await chrome.windows.create({ url: urls, state: "minimized", focused: false });
    await chrome.storage.session.set({ syncTabs: win.tabs.map((t) => t.id) });
    const ok = await waitUntilSynced(startedAt, Boolean(feedpulseUrl), wantPortflow);
    await chrome.storage.local.set({ syncStatus: { running: false, finishedAt: new Date().toISOString(), ok } });
  } catch (err) {
    await chrome.storage.local.set({ syncStatus: { running: false, finishedAt: new Date().toISOString(), ok: false, error: String(err) } });
  } finally {
    await chrome.storage.session.set({ syncTabs: [] });
    if (win) await chrome.windows.remove(win.id).catch(() => {});
  }
}

async function startSync(force) {
  if (running) return { started: false, running: true };
  const { feedpulse, portflow } = await chrome.storage.local.get(["feedpulse", "portflow"]);
  const wantFeedpulse = force || isStale(feedpulse?.syncedAt);
  const wantPortflow = force || isStale(portflow?.evidenceSyncedAt) || isStale(portflow?.goalsSyncedAt);
  if (!wantFeedpulse && !wantPortflow) return { started: false };
  running = runSync(wantFeedpulse, wantPortflow).finally(() => { running = null; });
  return { started: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "dr-sync") {
    startSync(Boolean(msg.force)).then(sendResponse, () => sendResponse({ started: false }));
    return true;
  }
  if (msg?.type === "dr-is-sync-tab") {
    chrome.storage.session.get("syncTabs").then(({ syncTabs = [] }) => sendResponse(syncTabs.includes(sender.tab?.id)));
    return true;
  }
  return false;
});
