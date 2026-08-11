// Pushcut SOUND routing — the ONE place to edit to change sounds per task type.
//
// The router sends EVERY reminder to a single Pushcut notification
// (PUSHCUT_NOTIFICATION_NAME) and picks the SOUND per task here, passing it in
// the payload — a payload `sound` overrides the notification's configured sound.
// So adding a new alert type is a one-line rule below; there is NO new Pushcut
// notification to create (this replaced the old one-notification-per-tier model).
//
// Rules are checked top-to-bottom, FIRST MATCH WINS; the last rule (no `when`) is
// the catch-all default. Each rule sets:
//   sound — a Pushcut sound. '' = use the notification's own configured sound.
//           Built-ins (zero setup): vibrateOnly, system, subtle, question,
//           jobDone, problem, loud, lasers. Or a CUSTOM sound's exact name
//           (must be imported into Pushcut on the receiving device first).
//   label — short tier tag shown in the notification subtitle (before the due time).
//
// Task fields available to `when(task)` (Todoist API v1 task object):
//   task.priority   1–4   (INVERTED vs UI: API 4 === UI "P1" = most urgent)
//   task.labels     string[]  personal label names, e.g. ["bill","urgent"]
//   task.content    string    the task title
//   task.project_id string
//   task.due        { date, datetime, string, is_recurring, ... } | null

// Helper: does the task carry a given Todoist label? (case-insensitive)
const hasLabel = (task, label) =>
  (task.labels || []).some((l) => l.toLowerCase() === label.toLowerCase())

const RULES = [
  // --- Priority tiers FIRST, so P1 always wins (even if it also has a label) --
  // `critical: true` → sent via Pushover as an iOS Critical Alert (pierces the
  // physical mute switch + DnD). Pushcut CANNOT do critical alerts (Apple denied
  // it the entitlement), so the urgent tier uses Pushover instead. `sound` here
  // is only the Pushcut FALLBACK sound used if Pushover isn't configured.
  { when: (t) => t.priority === 4, critical: true, sound: 'beedeedeep', label: '🔴 Urgent' }, // UI P1

  // --- Label-based (add your granular types here — one line each) ----------
  { when: (t) => hasLabel(t, 'bill'),   sound: 'problem',  label: '💸 Bill due' },
  { when: (t) => hasLabel(t, 'health'), sound: 'subtle',   label: '🩺 Health' },
  { when: (t) => hasLabel(t, 'errand'), sound: 'question', label: '🏃 Errand' },

  // --- Catch-all default (must stay last; no `when`) ----------------------
  { sound: '', label: 'Reminder' }, // '' = the notification's own configured sound
]

// First matching rule wins; the catch-all (no `when`) always matches.
function routeNotification(task) {
  const rule = RULES.find((r) => !r.when || r.when(task))
  return { sound: rule.sound, label: rule.label, critical: !!rule.critical }
}

module.exports = { routeNotification, RULES, hasLabel }
