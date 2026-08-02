// Pushcut routing rules — the ONE place you edit to add a new alert type.
//
// How routing works: rules are checked top-to-bottom, FIRST MATCH WINS, and the
// last rule (no `when`) is the catch-all default. Each rule maps a task to a
// Pushcut notification `name` (created in the Pushcut app, where its sound lives)
// and the `title` shown on the notification.
//
// To add a granular alert:
//   1. Create a notification in the Pushcut app (give it the sound you want).
//   2. Add a rule below with a `when(task)` predicate and that notification name.
//   3. Deploy. No engine code changes.
//
// Task fields available to `when(task)` (Todoist API v1 task object):
//   task.priority  1–4   (INVERTED vs UI: API 4 === UI "P1" = most urgent)
//   task.labels    string[]  personal label names, e.g. ["bill","urgent"]
//   task.content   string    the task title
//   task.project_id string
//   task.due       { date, datetime, string, is_recurring, ... } | null
//
// `name` can be a literal string or an env var (so secrets/names stay swappable
// without a code edit). `env('FOO', 'fallback')` reads process.env.FOO.

const env = (key, fallback) => process.env[key] || fallback

// Helper: does the task carry a given Todoist label? (case-insensitive)
const hasLabel = (task, label) =>
  (task.labels || []).some((l) => l.toLowerCase() === label.toLowerCase())

const ROUTES = [
  // --- Label-based routes (add your granular types here) -------------------
  // Each needs a matching notification of the same name in the Pushcut app.
  {
    when: (t) => hasLabel(t, 'bill'),
    name: env('PUSHCUT_BILL_NOTIFICATION_NAME', 'BillDue'),
    title: '💸 Bill due',
  },
  {
    when: (t) => hasLabel(t, 'health'),
    name: env('PUSHCUT_HEALTH_NOTIFICATION_NAME', 'HealthReminder'),
    title: '🩺 Health',
  },
  {
    when: (t) => hasLabel(t, 'errand'),
    name: env('PUSHCUT_ERRAND_NOTIFICATION_NAME', 'ErrandReminder'),
    title: '🏃 Errand',
  },

  // --- Priority tiers (checked after labels) ------------------------------
  {
    when: (t) => t.priority === 4, // UI P1
    name: env('PUSHCUT_URGENT_NOTIFICATION_NAME', 'UrgentTask'),
    title: '🔴 Urgent',
  },

  // --- Catch-all default (must stay last; no `when`) ----------------------
  {
    name: env('PUSHCUT_NOTIFICATION_NAME', 'TodoistTaskReminder'),
    title: 'Reminder',
  },
]

// First matching rule wins; the catch-all (no `when`) always matches.
function routeNotification(task) {
  const rule = ROUTES.find((r) => !r.when || r.when(task))
  return { name: rule.name, title: rule.title }
}

module.exports = { routeNotification, ROUTES, hasLabel }
