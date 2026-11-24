## Parameters

### Week 1 to 4
- Feedpulse amount: 3
- Latest feedpulse: 4
- Feedpulse latest smiley-rating: 2
- Portfolio hand-in date evidence per learning outcome: 0
- Attendance: 4
- Grades: 1
- Time (which week of the semester it is): n.a.
- Assignments (submission time / late / missing): missing: 3, late < 48h: 2, late > 48h: 2.5, early: 1

### Week 5 to 10
- Feedpulse amount: 3
- Latest feedpulse: 4
- Feedpulse latest smiley-rating: 4
- Portfolio hand-in date evidence per learning outcome: 3
- Attendance: 2
- Grades: 4
- Time (which week of the semester it is): n.a.
- Assignments (submission time / late / missing): missing: 3, late < 48h: 2, late > 48h: 2.5, early: 1

### Week 11 to 16
- Feedpulse amount: 4
- Latest feedpulse: 3
- Feedpulse latest smiley-rating: 4
- Portfolio hand-in date evidence per learning outcome: 3
- Attendence: 1
- Grades: 5
- Time (which week of the semester it is): n.a.
- Assignments (submission time / late / missing): missing: 4, late < 48h: 2, late > 48h: 2.5, early: 1

### Week 17+
- Feedpulse amount: 3
- Latest feedpulse: 2
- Feedpulse latest smiley-rating: 4
- Portfolio hand-in date evidence per learning outcome: 4
- Attendence: 1
- Grades: 6
- Time (which week of the semester it is): n.a.
- Assignments (submission time / late / missing): missing: 5, late < 48h: 2, late > 48h: 2.5, early: 1

### Rules for parameters
- weight is behind the parameter (: weight)
- Ignore teacher feedback in feedpulse
- portfolio hand-in date evidence per learning outcome means when you added the last piece of evidence to the portfolio
- look at smiley 
- grades compared to when it was graded
- feedpulse smileys: sad is bad, smile is good, happy smile is great
- Week 1 to 4 grades undefined is meh, orienting is fine, higher is great
- Week 5 to 10 grades undefined is not good, orienting is okay, beginning is good, higher is great
- Week 11 to 16 grades undefined is bad, orienting is meh, beginning is okayish, proficient is good, higher is great
- Week 17+ grades undefined is really bad, orienting is bad, beginning is not good, proficient is good, higher is great

## View
- Scale of likelyhood to pass for this student (dot on horizontal axis, fade green to yellow to red)
- Parameters it uses

























## Chrome extension (student view)
The extension lives in `extension/`. It reads the student's own data using the browser's existing logins, so no API tokens are needed. The popup shows the likelihood to pass on a green-to-red scale, followed by every parameter with its weight for the current week and its score.

| Parameter | Source |
|---|---|
| Feedpulse amount / latest / smiley | `content/feedpulse.js` reads the checkpoints (your summaries and the smiley icon) when you open Feedpulse inside Canvas. Teacher feedback text is ignored. |
| Portfolio evidence per learning outcome | `content/portflow-hook.js` + `content/portflow.js` copy the responses Portflow already loads on **My evidence** (date each piece was added, linked learning outcomes) and **Goals & Progress** (evidence count per outcome). |
| Attendance | The "Roll Call Attendance" assignment in Canvas |
| Grades | Learning-outcome levels from Canvas outcome rollups, judged by the week they were graded |
| Time | Week number taken from "… - Week N" assignment due dates, because school weeks skip holidays. It selects the weight table. |
| Assignments | Canvas `submitted_at` vs `due_at`: missing, up to 48 hours late, more than 48 hours late, handed in before the deadline |

The weights and scoring rules are in `extension/popup/model.js`. All Canvas calls are in `extension/data/canvas.js`. Only courses whose term includes today are used.

### Privacy & data
- **No server, no analytics.** Everything runs in the student's own browser. The extension only talks to Canvas, Feedpulse and Portflow, which already hold this data.
- **Read, not stored:** Canvas courses, assignments and hand-in times, grades and learning-outcome levels, attendance, and the student's name and email. These are loaded fresh every time the popup opens.
- **Stored in `chrome.storage.local`:**
  - Feedpulse: checkpoint dates, whether the student wrote a summary, and the smiley.
  - Portflow: per learning outcome, the evidence count and when evidence was last added.
  - Settings: attendance on/off, grace days, auto-sync.
  - Never stored: feedback text, evidence names or files.
- **Student controls:** the **i** button opens a *Privacy & data* panel that explains this. It has a switch to turn automatic Feedpulse/Portflow syncing off, also enforced in `background.js`, and a **Delete** button that removes the stored summaries while keeping settings. Uninstalling the extension removes everything.
- **The percentage is an indication, not a decision.** It is calculated from the parameters and weights shown in the popup.
- **Teacher use:** the extension reads whoever is logged in, so a teacher only sees their own account. Using it to score students (a teacher view, or a Fontys rollout) is profiling of students by the institution. That needs a legal basis, a DPIA and the Fontys privacy officer's involvement before it is built.

**Load it in Chrome**
1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Pin Dropout Radar from the puzzle-piece menu and click it.
4. Make sure you're logged in to Canvas. Feedpulse and Portflow sync automatically: when the popup opens and their data is older than 6 hours (or you click refresh), `background.js` opens them in a minimized window, the content scripts read them, and the window closes again.

Attendance can be switched off in the popup, because not every teacher takes attendance. Assignment sub-parameters (missing, late < 48h, late > 48h, early) only count when they apply. The **Grace** selector (0–7 days) moves every deadline, so with 2 a hand-in up to 2 days late still counts as on time. The **Remind** button in the Feedpulse group opens an email to the student's Canvas email address with "Hey <first name>, maybe you should go for a FeedPulse again?".

After editing files, click the reload icon on the extension card.