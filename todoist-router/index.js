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

// routeNotification lives in ./routes.js — a declarative first-match-wins rule
// table. Add new alert types there; the webhook engine below never changes.

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
