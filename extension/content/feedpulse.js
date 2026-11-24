// Runs inside the Feedpulse iframe (app.feedpulse.com) when the student opens
// Feedpulse in Canvas. Feedpulse's session only exists inside that iframe, so
// this is the only place its data can be read. We store a summary of each
// checkpoint (no feedback text) for the popup.

(() => {
  const SMILEYS = { happy: "happy", smile: "smile", sad: "sad", frown: "sad", meh: "neutral", neutral: "neutral" };

  function parseCard(card) {
    const head = card.querySelector(".ant-card-head");
    const headText = head?.textContent ?? "";
    const number = headText.match(/Checkpoint\s+(\d+)/)?.[1];
    if (!number) return null;

    const strongs = [...head.querySelectorAll("strong")].map((s) => s.textContent.trim());
    const dateText = head.querySelector(".ant-typography-secondary")?.textContent.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    const [, d, mo, y] = dateText ? dateText.map(Number) : [];

    // The rating is an icon like <span class="icon-happy _smiley_...">.
    const iconClass = [...(card.querySelector(".ant-card-extra")?.querySelectorAll("[class*='icon-']") ?? [])]
      .flatMap((el) => [...el.classList])
      .find((c) => c.startsWith("icon-"));
    const smiley = iconClass ? SMILEYS[iconClass.slice(5)] ?? null : null;

    const body = card.querySelector(".ant-card-body")?.innerText ?? "";
    const teacherEntries = (body.match(/\((Teacher|Docent)\)/gi) ?? []).length;
    const allEntries = (body.match(/\b(ago|geleden)\b/gi) ?? []).length;

    return {
      number: Number(number),
      title: strongs.slice(1).join(" ") || `Checkpoint ${number}`,
      date: y ? new Date(y, mo - 1, d).toISOString() : null,
      smiley,
      teacherFeedback: teacherEntries > 0,
      studentEntry: allEntries > teacherEntries,
    };
  }

  let lastSaved = "";
  function sync() {
    const checkpoints = [...document.querySelectorAll(".ant-card")].map(parseCard).filter(Boolean);
    if (!checkpoints.length) return;
    const key = JSON.stringify(checkpoints);
    if (key === lastSaved) return;
    lastSaved = key;
    chrome.storage.local.set({ feedpulse: { syncedAt: new Date().toISOString(), checkpoints } });
  }

  // Feedpulse renders its content after load, so watch for changes for a while.
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(() => observer.disconnect(), 60_000);
  sync();
})();
