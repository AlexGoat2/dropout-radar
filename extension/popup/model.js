// The pass-likelihood model from README.md: every parameter gets a score from
// 0 (bad) to 1 (great), and the weights depend on the week of the semester.
// Likelihood = sum(weight * score) / sum(weight), over parameters with data.

export const PHASES = [
  { name: "Weeks 1–4", from: 1, to: 4,
    weights: { feedpulseAmount: 3, feedpulseLatest: 4, feedpulseSmiley: 2, portfolio: 0, attendance: 4, grades: 1, missing: 3, lateShort: 2, lateLong: 2.5, early: 1 } },
  { name: "Weeks 5–10", from: 5, to: 10,
    weights: { feedpulseAmount: 3, feedpulseLatest: 4, feedpulseSmiley: 4, portfolio: 3, attendance: 2, grades: 4, missing: 3, lateShort: 2, lateLong: 2.5, early: 1 } },
  { name: "Weeks 11–16", from: 11, to: 16,
    weights: { feedpulseAmount: 4, feedpulseLatest: 3, feedpulseSmiley: 4, portfolio: 3, attendance: 1, grades: 5, missing: 4, lateShort: 2, lateLong: 2.5, early: 1 } },
  { name: "Week 17+", from: 17, to: Infinity,
    weights: { feedpulseAmount: 3, feedpulseLatest: 2, feedpulseSmiley: 4, portfolio: 4, attendance: 1, grades: 6, missing: 5, lateShort: 2, lateLong: 2.5, early: 1 } },
];

const phaseIndex = (week) => {
  const i = PHASES.findIndex((p) => week >= p.from && week <= p.to);
  return i === -1 ? PHASES.length - 1 : i;
};
export const phaseFor = (week) => PHASES[phaseIndex(week)];

// Grades are judged by the phase in which they were graded (README rules).
const GRADE_SCORES = [
  { Undefined: 0.5, Orienting: 0.75, Beginning: 1, Proficient: 1, Advanced: 1 }, // meh, fine, great
  { Undefined: 0.25, Orienting: 0.5, Beginning: 0.75, Proficient: 1, Advanced: 1 }, // not good, okay, good, great
  { Undefined: 0, Orienting: 0.35, Beginning: 0.55, Proficient: 0.8, Advanced: 1 }, // bad, meh, okayish, good, great
  { Undefined: 0, Orienting: 0.1, Beginning: 0.3, Proficient: 0.8, Advanced: 1 }, // really bad, bad, not good, good, great
];

// Feedpulse smileys: sad is bad, smile is good, happy smile is great.
const SMILEY_SCORES = { happy: 1, smile: 0.75, neutral: 0.45, sad: 0.1 };
const SMILEY_LABELS = { happy: "Happy 😄", smile: "Smile 🙂", neutral: "Neutral 😐", sad: "Sad 🙁" };

const DAY = 24 * 60 * 60 * 1000;
const clamp = (x) => Math.min(1, Math.max(0, x));
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / DAY));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const normalize = (name) => name.replace(/^\s*\d+\.\s*/, "").trim().toLowerCase();

const levelName = (o) => {
  const name = o.level === "Mastery" ? "Proficient" : o.level;
  if (name in GRADE_SCORES[0]) return name;
  return o.score >= 5 ? "Advanced" : o.score >= 3 ? "Proficient" : o.score >= 2 ? "Beginning" : o.score >= 1 ? "Orienting" : "Undefined";
};

// The current semester's learning outcomes in Portflow. Portflow keeps goal
// sets from earlier semesters with the same names, so match the Canvas outcome
// names and take the most recently created goal for each.
function currentGoals(data) {
  const pf = data.portflow;
  const goals = Object.values(pf?.goals ?? {});
  if (!goals.length) return [];
  const newestFirst = [...goals].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const canvasNames = [...new Set(data.outcomes.map((o) => normalize(o.name)))];
  const picked = canvasNames.length
    ? canvasNames.map((n) => newestFirst.find((g) => normalize(g.name) === n)).filter(Boolean)
    : newestFirst.filter((g) => newestFirst[0].createdAt && new Date(newestFirst[0].createdAt) - new Date(g.createdAt) < 7 * DAY);

  return picked.map((g) => ({
    ...g,
    lastEvidenceAt: pf.lastEvidence?.[g.id] ?? (g.evidenceCount > 0 ? pf.oldestSeen : null),
  }));
}

export function computeParameters(data, settings = {}) {
  const now = Date.now();
  const week = data.semester.currentWeek;
  const weights = phaseFor(week).weights;
  const params = [];
  const add = (key, group, label, result) => params.push({ key, group, label, weight: weights[key], ...result });

  // ---- Feedpulse (teacher feedback text is ignored) ----
  const cps = (data.feedpulse?.checkpoints ?? [])
    .filter((c) => c.date && new Date(c.date) <= now)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const noFeedpulse = { score: null, value: "Not synced yet, syncs automatically" };

  if (cps.length) {
    const withEntry = cps.filter((c) => c.studentEntry);
    add("feedpulseAmount", "Feedpulse", "Feedpulse amount", {
      score: withEntry.length / cps.length,
      value: `${withEntry.length} of ${plural(cps.length, "checkpoint")} with your summary`,
    });

    const latest = withEntry[0];
    const days = latest ? daysSince(latest.date) : null;
    add("feedpulseLatest", "Feedpulse", "Latest Feedpulse", latest
      ? { score: clamp(1 - (days - 7) / 21), value: days === 0 ? "Today" : `${plural(days, "day")} ago` }
      : { score: 0, value: "No summaries posted yet" });

    const rated = cps.find((c) => c.smiley in SMILEY_SCORES);
    add("feedpulseSmiley", "Feedpulse", "Latest smiley rating", rated
      ? { score: SMILEY_SCORES[rated.smiley], value: `${SMILEY_LABELS[rated.smiley]} on checkpoint ${rated.number}${rated === cps[0] ? "" : " (latest with a smiley)"}` }
      : { score: null, value: "No rating yet" });
  } else {
    add("feedpulseAmount", "Feedpulse", "Feedpulse amount", noFeedpulse);
    add("feedpulseLatest", "Feedpulse", "Latest Feedpulse", noFeedpulse);
    add("feedpulseSmiley", "Feedpulse", "Latest smiley rating", noFeedpulse);
  }

  // ---- Portfolio: last evidence per learning outcome ----
  const goals = currentGoals(data);
  if (goals.length) {
    const scored = goals.map((g) => ({
      ...g,
      days: g.lastEvidenceAt ? daysSince(g.lastEvidenceAt) : null,
      score: g.lastEvidenceAt ? clamp(1 - (daysSince(g.lastEvidenceAt) - 14) / 28) : 0,
    }));
    const stalest = [...scored].sort((a, b) => a.score - b.score)[0];
    add("portfolio", "Portfolio", "Evidence per learning outcome", {
      score: scored.reduce((s, g) => s + g.score, 0) / scored.length,
      value: stalest.days == null
        ? `${stalest.nickname || stalest.name} has no evidence yet`
        : `Oldest: ${stalest.nickname || stalest.name}, ${plural(stalest.days, "day")} ago`,
      details: scored.map((g) => ({
        label: `${g.nickname ? `${g.nickname} ` : ""}${g.name}`,
        value: g.days == null ? "No evidence" : g.days === 0 ? "Today" : `${g.days}d ago`,
        score: g.score,
      })),
    });
  } else {
    add("portfolio", "Portfolio", "Evidence per learning outcome", {
      score: null, value: "Not synced yet, syncs automatically",
    });
  }

  // ---- Attendance (can be switched off: not every teacher takes it) ----
  const attendanceOn = settings.attendance !== false;
  add("attendance", "Attendance", "Attendance", {
    toggle: { key: "attendance", on: attendanceOn },
    disabled: !attendanceOn,
    ...(!attendanceOn
      ? { score: null, value: "Turned off, not counted" }
      : data.attendance
        ? { score: clamp((data.attendance.percent - 50) / 40), value: `${data.attendance.percent}% (Roll Call)` }
        : { score: null, value: "Not tracked in Canvas" }),
  });

  // ---- Grades: learning-outcome levels, judged by when they were graded ----
  if (data.outcomes.length) {
    const scored = data.outcomes.map((o) => {
      const level = levelName(o);
      return { level, score: GRADE_SCORES[phaseIndex(o.assessedWeek ?? week)][level] };
    });
    const counts = scored.reduce((m, o) => m.set(o.level, (m.get(o.level) ?? 0) + 1), new Map());
    const common = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const gradedWeek = Math.max(...data.outcomes.map((o) => o.assessedWeek ?? 0));
    add("grades", "Grades", "Learning outcome levels", {
      score: scored.reduce((s, o) => s + o.score, 0) / scored.length,
      value: `Mostly ${common}${gradedWeek ? `, graded in week ${gradedWeek}` : ""}`,
    });
  } else {
    add("grades", "Grades", "Learning outcome levels", { score: null, value: "No grades yet" });
  }

  // ---- Assignments: missing / late < 48h / late > 48h / on time ----
  const submittable = data.assignments.filter((a) => a.needsSubmission);
  // Only the categories that actually occur are shown and counted, e.g. no
  // "late" rows when nothing was handed in late. Grace days move every
  // deadline: with 2, a hand-in up to 2 days late still counts as on time.
  const graceMs = (Number(settings.graceDays) || 0) * DAY;
  const deadline = (a) => new Date(a.dueAt).getTime() + graceMs;
  const due = submittable.filter((a) => a.dueAt && deadline(a) < now);
  const missing = due.filter((a) => !a.submittedAt);
  if (missing.length) {
    add("missing", "Assignments", "Missing", {
      score: 1 - missing.length / due.length,
      value: `${missing.length} of ${due.length} due ${due.length === 1 ? "is" : "are"} missing`,
    });
  }

  // Hours late per submission (negative = handed in before the deadline).
  const hoursLate = submittable
    .filter((a) => a.submittedAt && a.dueAt)
    .map((a) => (new Date(a.submittedAt) - deadline(a)) / (60 * 60 * 1000));
  const total = hoursLate.length;
  const lateShort = hoursLate.filter((h) => h > 0 && h <= 48).length;
  const lateLong = hoursLate.filter((h) => h > 48).length;
  const onTime = total - lateShort - lateLong;
  if (lateShort) {
    add("lateShort", "Assignments", "Late, less than 48 hours", {
      score: 1 - lateShort / total, value: `${lateShort} of ${total} handed in up to 2 days late`,
    });
  }
  if (lateLong) {
    add("lateLong", "Assignments", "Late, more than 48 hours", {
      score: 1 - lateLong / total, value: `${lateLong} of ${total} handed in more than 2 days late`,
    });
  }
  if (onTime) {
    add("early", "Assignments", "Early", {
      score: onTime / total, value: `${onTime} of ${total} handed in on time`,
    });
  }

  return params;
}

export function likelihood(params) {
  const counted = params.filter((p) => p.score != null && p.weight > 0 && !p.disabled);
  const totalWeight = counted.reduce((s, p) => s + p.weight, 0);
  if (!totalWeight) return null;
  return counted.reduce((s, p) => s + p.weight * p.score, 0) / totalWeight;
}
