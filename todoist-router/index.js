const express = require('express')
const crypto = require('crypto')
const { routeNotification } = require('./routes')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))

function verifyTodoist(req) {
  const sig = req.headers['x-todoist-hmac-sha256'] || ''
  const expected = crypto
    .createHmac('sha256', process.env.TODOIST_CLIENT_SECRET)
    .update(req.rawBody)
    .digest('base64')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function fetchTask(itemId) {
  const res = await fetch(`https://api.todoist.com/api/v1/tasks/${itemId}`, {
    headers: { Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` }
  })
  if (!res.ok) throw new Error(`todoist task lookup ${res.status}`)
  return res.json()
}

// routeNotification lives in ./routes.js — a declarative first-match-wins table
// that picks the SOUND + subtitle label per task. Add new alert types there; the
// webhook engine below never changes. Everything fires to one Pushcut
// notification (PUSHCUT_NOTIFICATION_NAME); the sound is set per task.

async function sendPushcut(name, { title, text, url, sound }) {
  const payload = { title, text }
  // A payload sound overrides the notification's configured sound; omit to keep it.
  if (sound) payload.sound = sound
  if (url) {
    // Tapping the notification opens the task; plus an explicit button.
    payload.defaultAction = { url }
    payload.actions = [{ name: 'Open in Todoist', url }]
  }
  const res = await fetch(`https://api.pushcut.io/v1/notifications/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'API-Key': process.env.PUSHCUT_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`pushcut ${res.status} ${await res.text()}`)
}

// Pushover — used ONLY for the critical (urgent) tier, because it holds Apple's
// Critical Alerts entitlement (Pushcut does not), so priority-1/2 messages pierce
// the physical mute switch + DnD once the user enables Critical Alerts on-device.
// Returns true if sent, false if not configured or on failure (so the caller can
// fall back to Pushcut). Never throws.
async function sendPushover({ title, message, url, urlTitle }) {
  const token = process.env.PUSHOVER_TOKEN
  const user = process.env.PUSHOVER_USER_KEY
  if (!token || !user) return false // not set up yet → caller falls back to Pushcut
  const priority = process.env.PUSHOVER_PRIORITY || '1' // 1 = high (critical, no ack); 2 = emergency (repeat-until-ack)
  const body = new URLSearchParams({
    token, user, title, message,
    priority,
    sound: process.env.PUSHOVER_SOUND || 'siren',
  })
  if (url) { body.set('url', url); body.set('url_title', urlTitle || 'Open in Todoist') }
  if (priority === '2') { // emergency requires retry/expire
    body.set('retry', process.env.PUSHOVER_RETRY || '60')
    body.set('expire', process.env.PUSHOVER_EXPIRE || '600')
  }
  try {
    const res = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) { console.error(`pushover ${res.status} ${await res.text()}`); return false }
    return true
  } catch (e) {
    console.error('pushover failed:', e.message)
    return false
  }
}

// Universal link — opens the task in the Todoist app if installed, else the web app.
function todoistTaskUrl(task) {
  return `https://app.todoist.com/app/task/${task.id}`
}

// Health check (Railway pings this; also handy to open in a browser).
app.get('/', (_req, res) => res.status(200).send('todoist-router ok'))

app.post('/webhook', async (req, res) => {
  if (!verifyTodoist(req)) return res.sendStatus(401)
  res.status(200).send('ok') // ack first; Todoist retries on timeout/non-200

  const event = req.body
  if (event.event_name !== 'reminder:fired') return

  const reminder = event.event_data
  try {
    const task = await fetchTask(reminder.item_id)
    const route = routeNotification(task)
    // Task name is the headline; tier label + due time are the subtitle.
    const due = task.due && task.due.string
    const text = due ? `${route.label} · ${due}` : route.label
    const url = todoistTaskUrl(task)

    // Critical tier → Pushover (iOS Critical Alert, pierces mute switch + DnD).
    // If Pushover isn't configured (or fails), fall through to Pushcut.
    if (route.critical && await sendPushover({ title: task.content, message: text, url, urlTitle: 'Open in Todoist' })) return

    // Everything else (and the critical fallback) → one Pushcut notification,
    // sound set per task in the payload.
    const notification = process.env.PUSHCUT_NOTIFICATION_NAME || 'TodoistTaskReminder'
    await sendPushcut(notification, { title: task.content, text, url, sound: route.sound })
  } catch (err) {
    console.error('push failed:', err)
  }
})

app.listen(PORT)
