// Receives Portflow responses from content/portflow-hook.js and stores a small
// summary per learning outcome (goal): its evidence count and when evidence
// was last added. Evidence names and contents are not stored.

(() => {
  const summarizeGoal = (g) => ({
    id: g.id,
    name: g.name,
    nickname: g.nickname ?? "",
    createdAt: g.created_at ?? null,
    evidenceCount: g.evidence_count ?? 0,
  });

  async function save(kind, items) {
    if (!Array.isArray(items)) return;
    const { portflow = { goals: {}, lastEvidence: {}, oldestSeen: null } } = await chrome.storage.local.get("portflow");

    if (kind === "goals") {
      for (const g of items) portflow.goals[g.id] = summarizeGoal(g);
      portflow.goalsSyncedAt = new Date().toISOString();
    }

    if (kind === "evidence") {
      for (const e of items) {
        const added = e.created_at;
        if (!added) continue;
        if (!portflow.oldestSeen || added < portflow.oldestSeen) portflow.oldestSeen = added;
        for (const g of e.goals ?? []) {
          portflow.goals[g.id] = { ...summarizeGoal(g), ...portflow.goals[g.id], evidenceCount: g.evidence_count ?? 0 };
          if (!portflow.lastEvidence[g.id] || added > portflow.lastEvidence[g.id]) portflow.lastEvidence[g.id] = added;
        }
      }
      portflow.evidenceSyncedAt = new Date().toISOString();
    }

    portflow.syncedAt = new Date().toISOString();
    await chrome.storage.local.set({ portflow });
  }

  // If background.js opened this tab for a sync, tell the page script to walk
  // through the evidence and goals pages by itself.
  chrome.runtime.sendMessage({ type: "dr-is-sync-tab" }).then((isSyncTab) => {
    if (isSyncTab) window.postMessage({ source: "dropout-radar-control", action: "auto-sync" }, location.origin);
  }, () => {});

  // Saves are read-modify-write, so run them one at a time.
  let queue = Promise.resolve();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "dropout-radar") return;
    const { kind, data } = event.data;
    queue = queue.then(() => save(kind, data)).catch(() => {});
  });
})();
