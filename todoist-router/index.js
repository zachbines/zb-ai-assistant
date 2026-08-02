const express = require('express')
const crypto = require('crypto')

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

// Pick the Pushcut notification (and title) by task priority.
// NOTE: Todoist's API priority is INVERTED vs the UI — API 4 === UI "P1" (urgent).
function routeNotification(task) {
  const urgent = process.env.PUSHCUT_URGENT_NOTIFICATION_NAME || 'UrgentTask'
  const normal = process.env.PUSHCUT_NOTIFICATION_NAME || 'TodoistTaskReminder'
  if (task.priority === 4) return { name: urgent, title: '🔴 Urgent' }
  return { name: normal, title: 'Reminder' }
}

async function sendPushcut(name, { title, text }) {
  const res = await fetch(`https://api.pushcut.io/v1/notifications/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'API-Key': process.env.PUSHCUT_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, text })
  })
  if (!res.ok) throw new Error(`pushcut ${res.status} ${await res.text()}`)
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
    await sendPushcut(route.name, { title: route.title, text: task.content })
  } catch (err) {
    console.error('push failed:', err)
  }
})

app.listen(PORT)
