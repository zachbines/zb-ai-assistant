const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = process.env.PORT || 3000
const PAGE = path.join(__dirname, 'public', 'index.html')
const MAX_BODY = 64 * 1024

// Wrong-passcode lockout: after MAX_MISSES misses in LOCK_MS, refuse for the rest of the window.
const MAX_MISSES = 10
const LOCK_MS = 10 * 60 * 1000
let misses = []

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY) { reject(new Error('too large')); req.destroy() }
    })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

// Hash both sides so timingSafeEqual always compares equal-length buffers.
function passcodeMatches(given) {
  const want = process.env.NAP_PLAN_PASSCODE || ''
  const a = crypto.createHash('sha256').update(String(given || '')).digest()
  const b = crypto.createHash('sha256').update(want).digest()
  return crypto.timingSafeEqual(a, b)
}

// When each kind of moment alerts, in minutes before its due time. These replace
// Todoist's automatic reminder on the task. A kind not listed keeps Todoist's default.
const ALERT_OFFSETS = {
  start: [30, 5],
  end: [10, 0],
}

// Only accept what the page sends, and build the Todoist task here so callers
// can't pick other labels or projects. Returns null if anything is off.
function cleanTasks(input) {
  if (!Array.isArray(input) || !input.length || input.length > 25) return null
  const out = []
  for (const t of input) {
    if (!t || typeof t.content !== 'string' || typeof t.dueString !== 'string') return null
    const content = t.content.trim().slice(0, 200)
    const due = t.dueString.trim()
    if (!content || !/^(today|tomorrow) at \d{1,2}:\d{2}(am|pm)$/.test(due)) return null
    if (t.kind != null && !['start', 'end', 'bed'].includes(t.kind)) return null
    const task = { content, due_string: due, labels: ['nap'], description: 'Planned in Nap Plan.' }
    if (t.duration != null) {
      const m = Math.round(Number(t.duration))
      if (!(m > 0 && m <= 600)) return null
      task.duration = m
      task.duration_unit = 'minute'
    }
    out.push({ task, offsets: ALERT_OFFSETS[t.kind] || null })
  }
  return out
}

const authHeader = () => ({ Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}` })

// Returns the new task's id.
async function createTask(task) {
  const res = await fetch('https://api.todoist.com/api/v1/tasks', {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  })
  if (!res.ok) throw new Error(`Todoist answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).id
}

async function todoistSync(fields) {
  const res = await fetch('https://api.todoist.com/api/v1/sync', {
    method: 'POST',
    headers: authHeader(),
    body: new URLSearchParams(fields),
  })
  if (!res.ok) throw new Error(`Todoist sync answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Give each task exactly the reminders in `wanted` (itemId -> minute offsets):
// remove the automatic ones that don't match, add the ones that are missing.
async function setReminders(wanted) {
  const ids = Object.keys(wanted)
  if (!ids.length) return
  const { reminders = [] } = await todoistSync({ sync_token: '*', resource_types: '["reminders"]' })
  const commands = []
  for (const id of ids) {
    const existing = reminders.filter((r) => String(r.item_id) === String(id) && !r.is_deleted && r.type === 'relative')
    const have = new Set()
    for (const r of existing) {
      if (wanted[id].includes(r.minute_offset) && !have.has(r.minute_offset)) have.add(r.minute_offset)
      else commands.push({ type: 'reminder_delete', uuid: crypto.randomUUID(), args: { id: r.id } })
    }
    for (const m of wanted[id]) {
      if (!have.has(m)) {
        commands.push({
          type: 'reminder_add', uuid: crypto.randomUUID(), temp_id: crypto.randomUUID(),
          args: { item_id: id, type: 'relative', minute_offset: m, service: 'push' },
        })
      }
    }
  }
  if (!commands.length) return
  const { sync_status: status = {} } = await todoistSync({ commands: JSON.stringify(commands) })
  const failed = Object.values(status).filter((s) => s !== 'ok')
  if (failed.length) throw new Error(`Todoist refused ${failed.length} reminder change(s): ${JSON.stringify(failed[0]).slice(0, 200)}`)
}

async function addTasks(req, res) {
  if (!process.env.NAP_PLAN_PASSCODE || !process.env.TODOIST_API_TOKEN) {
    return sendJson(res, 503, { error: 'The server is missing NAP_PLAN_PASSCODE or TODOIST_API_TOKEN. Add both in Railway → Variables.' })
  }
  const now = Date.now()
  misses = misses.filter((t) => now - t < LOCK_MS)
  if (misses.length >= MAX_MISSES) return sendJson(res, 429, { error: 'Too many wrong passcodes.' })
  if (!passcodeMatches(req.headers['x-nap-passcode'])) {
    misses.push(now)
    return sendJson(res, 401, { error: 'Wrong passcode.' })
  }

  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: 'The request could not be read.' }) }
  const tasks = cleanTasks(body.tasks)
  if (!tasks) return sendJson(res, 400, { error: 'The reminder list was not in the expected format.' })

  // One at a time, so a failure part-way through reports exactly how many landed.
  let added = 0
  const wanted = {}
  for (const { task, offsets } of tasks) {
    try {
      const id = await createTask(task)
      added++
      if (offsets && id) wanted[id] = offsets
    } catch (e) {
      console.error('todoist create failed:', e.message)
      return sendJson(res, 502, { added, error: e.message })
    }
  }
  // The tasks exist now; if their alert times can't be set, say so but don't call it a failure.
  try {
    await setReminders(wanted)
  } catch (e) {
    console.error('todoist reminders failed:', e.message)
    return sendJson(res, 200, { added, warning: e.message })
  }
  sendJson(res, 200, { added })
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return fs.readFile(PAGE, (err, html) => {
      if (err) { res.writeHead(500); return res.end('Page missing') }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })
  }
  if (req.method === 'POST' && pathname === '/api/todoist/tasks') {
    return addTasks(req, res).catch((e) => {
      console.error(e)
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' })
    })
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
})

server.listen(PORT, () => console.log(`Nap Plan is running at http://localhost:${PORT}`))
