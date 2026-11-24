// Reads the logged-in student's data from Canvas, using the browser's Canvas
// session (no API token needed). Feedpulse and Portflow are not in the Canvas
// API; they are captured by the content scripts and read from chrome.storage.

export const CANVAS_URL = "https://fontysict.instructure.com";

export class NotLoggedInError extends Error {}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const SUBMITTABLE = new Set([
  "online_upload", "online_url", "online_text_entry", "media_recording",
  "online_quiz", "discussion_topic", "student_annotation",
]);

const nextLink = (header) =>
  header?.split(",").find((p) => p.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1] ?? null;

// GET a Canvas API path, following pagination for list endpoints.
export async function api(path) {
  let url = CANVAS_URL + path;
  const items = [];
  while (url) {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    const isJson = res.headers.get("content-type")?.includes("json");
    if (res.status === 401 || !isJson) throw new NotLoggedInError();
    if (!res.ok) throw new Error(`Canvas returned ${res.status} for ${path}`);
    const data = JSON.parse((await res.text()).replace(/^while\(1\);/, ""));
    if (!Array.isArray(data)) return data;
    items.push(...data);
    url = nextLink(res.headers.get("link"));
  }
  return items;
}

const optional = (promise) => promise.catch((e) => (e instanceof NotLoggedInError ? Promise.reject(e) : []));

const mondayOf = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

// Fontys assignments are named "... - Week 10". Their due dates anchor the
// school-week numbering, which skips holidays, unlike plain calendar weeks.
function buildWeekCounter(assignments, term) {
  const anchors = assignments
    .map((a) => ({ week: Number(a.title.match(/\bweek\s*(\d+)/i)?.[1]), date: a.dueAt }))
    .filter((a) => a.week && a.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const allWeeks = assignments.map((a) => Number(a.title.match(/\bweek\s*(\d+)/i)?.[1])).filter(Boolean);
  const totalWeeks = Math.max(18, ...allWeeks);

  const weekAt = (date) => {
    const t = new Date(date);
    let week;
    if (anchors.length) {
      const anchor = [...anchors].reverse().find((a) => new Date(a.date) <= t) ?? anchors[0];
      week = anchor.week + Math.round((mondayOf(t) - mondayOf(anchor.date)) / WEEK);
    } else if (term?.start_at) {
      week = Math.floor((mondayOf(t) - mondayOf(term.start_at)) / WEEK) + 1;
    } else {
      week = 1;
    }
    return Math.min(Math.max(week, 1), totalWeeks);
  };
  return { weekAt, totalWeeks };
}

const kindOf = (name) =>
  /roll\s*call|attendance|aanwezig/i.test(name) ? "attendance" : /portfolio/i.test(name) ? "portfolio" : "assignment";

function normalizeAssignment(a, course) {
  const s = a.submission ?? {};
  return {
    id: a.id,
    title: a.name,
    course: course.course_code || course.name,
    url: a.html_url,
    kind: kindOf(a.name),
    dueAt: a.due_at,
    needsSubmission: a.submission_types.some((t) => SUBMITTABLE.has(t)),
    submittedAt: s.submitted_at ?? null,
    late: Boolean(s.late),
    missing: Boolean(s.missing),
    graded: s.workflow_state === "graded",
    grade: s.grade ?? null,
    score: s.score ?? null,
    pointsPossible: a.points_possible ?? null,
    gradingType: a.grading_type,
  };
}

function normalizeOutcomes(rollup, course) {
  const outcomes = new Map((rollup.linked?.outcomes ?? []).map((o) => [String(o.id), o]));
  return (rollup.rollups?.[0]?.scores ?? []).map((s) => {
    const o = outcomes.get(String(s.links.outcome)) ?? {};
    const ratings = [...(o.ratings ?? [])].sort((a, b) => b.points - a.points);
    const top = ratings[0]?.points ?? 5;
    return {
      name: (o.title ?? "Outcome").trim(),
      course: course.course_code || course.name,
      score: s.score,
      maxScore: top,
      level: ratings.find((r) => s.score >= r.points)?.description ?? String(s.score),
      assessedAt: s.submitted_at ?? null,
    };
  });
}

async function readSynced() {
  if (!globalThis.chrome?.storage?.local) return {};
  return chrome.storage.local.get(["feedpulse", "portflow"]);
}

// Active courses whose term (or course dates) cover today.
export async function currentCourses() {
  const now = new Date();
  const all = await api("/api/v1/courses?enrollment_state=active&include[]=term&per_page=100");
  return all.filter((c) => {
    const start = c.term?.start_at ?? c.start_at;
    const end = c.term?.end_at ?? c.end_at;
    return start && end && new Date(start) <= now && now <= new Date(end);
  });
}

export async function getStudentData() {
  const now = new Date();
  const [me, profile, courses] = await Promise.all([
    api("/api/v1/users/self"),
    api("/api/v1/users/self/profile").catch((e) => (e instanceof NotLoggedInError ? Promise.reject(e) : {})),
    currentCourses(),
  ]);

  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const [assignments, rollup] = await Promise.all([
        optional(api(`/api/v1/courses/${c.id}/assignments?include[]=submission&per_page=100`)),
        optional(api(`/api/v1/courses/${c.id}/outcome_rollups?user_ids[]=${me.id}&include[]=outcomes&per_page=100`)),
      ]);
      return {
        assignments: assignments.map((a) => normalizeAssignment(a, c)),
        outcomes: Array.isArray(rollup) ? [] : normalizeOutcomes(rollup, c),
      };
    })
  );

  const assignments = perCourse.flatMap((c) => c.assignments);
  const term = courses[0]?.term;
  const { weekAt, totalWeeks } = buildWeekCounter(assignments, term);

  const attendanceItems = assignments.filter((a) => a.kind === "attendance" && a.score != null && a.pointsPossible);
  const attendance = attendanceItems.length
    ? {
        percent: Math.round(
          (attendanceItems.reduce((s, a) => s + a.score / a.pointsPossible, 0) / attendanceItems.length) * 100
        ),
      }
    : null;

  const { feedpulse = null, portflow = null } = await readSynced();

  return {
    student: {
      name: me.short_name ?? me.name,
      // "Alexander A.D.J." -> "Alexander"; fall back to the part after the comma in "Last, First".
      firstName: (me.first_name || me.sortable_name?.split(",")[1] || me.name || "").trim().split(/\s+/)[0],
      email: profile.primary_email || (profile.login_id?.includes("@") ? profile.login_id : null),
    },
    courses: courses.map((c) => ({ id: c.id, name: c.course_code || c.name, url: `${CANVAS_URL}/courses/${c.id}` })),
    semester: { name: term?.name ?? "", currentWeek: weekAt(now), totalWeeks },
    assignments: assignments.filter((a) => a.kind !== "attendance"),
    attendance,
    outcomes: perCourse
      .flatMap((c) => c.outcomes)
      .map((o) => ({ ...o, assessedWeek: o.assessedAt ? weekAt(o.assessedAt) : null })),
    feedpulse,
    portflow,
    syncedAt: now.toISOString(),
  };
}
