// Runs in the page's own JS world inside the Portflow iframe
// (portfolio.drieam.app). Portflow keeps its login in memory, so we cannot call
// its API ourselves. Instead we passively copy the JSON responses Portflow
// already loads for its "Goals & Progress" and "My evidence" pages, and hand
// them to content/portflow.js. No auth headers or tokens are read.
//
// During a background sync (window opened by background.js), this script also
// moves Portflow to those two pages itself, using in-app navigation so the
// in-memory login is kept.

(() => {
  const WATCH = /\/api\/v1\/portfolios\/\d+\/(goals|evidence)$/;
  const originalFetch = window.fetch;
  const seen = new Set();
  const waiters = [];
  let apiReady = false;

  function notify(kind) {
    seen.add(kind);
    for (const w of waiters.filter((w) => w.kind === kind)) w.resolve(true);
  }

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = new URL(String(args[0]?.url ?? args[0]), location.href);
      if (url.pathname.startsWith("/api/")) apiReady = true;
      const kind = url.pathname.match(WATCH)?.[1];
      if (kind && response.ok) {
        response.clone().json().then((data) => {
          window.postMessage({ source: "dropout-radar", kind, data }, location.origin);
          notify(kind);
        }, () => {});
      }
    } catch {
      // Never break Portflow because of us.
    }
    return response;
  };

  // ---- Background sync: visit "My evidence" and "Goals & Progress" ----

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitFor(kind, ms) {
    if (seen.has(kind)) return Promise.resolve(true);
    return new Promise((resolve) => {
      waiters.push({ kind, resolve });
      setTimeout(() => resolve(false), ms);
    });
  }

  function goTo(path) {
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  function clickByText(text) {
    const el = [...document.querySelectorAll("button, a, [role='menuitem']")]
      .find((e) => e.textContent.trim() === text);
    el?.click();
    return Boolean(el);
  }

  async function visit(kind, path, label) {
    seen.delete(kind);
    goTo(path);
    if (await waitFor(kind, 6000)) return;
    if (clickByText(label)) await waitFor(kind, 6000);
  }

  async function autoSync() {
    // Wait until the app has started talking to its API (logged in).
    for (let i = 0; i < 40 && !apiReady; i++) await sleep(250);
    await sleep(1000);
    await visit("evidence", "/portfolio/evidence", "Evidence");
    await visit("goals", "/portfolio/progress", "Goals & Progress");
  }

  let started = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "dropout-radar-control") return;
    if (event.data.action === "auto-sync" && !started) {
      started = true;
      autoSync();
    }
  });
})();
