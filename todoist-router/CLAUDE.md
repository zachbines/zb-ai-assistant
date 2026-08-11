# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies (requires Node >= 18 for native `fetch`).
- `npm start` — run the webhook server (listens on `PORT`, default 3000).

There is no test suite, lint, or build step configured.

## Architecture

Single-file Express service (`index.js`) that receives Todoist `reminder:fired` webhooks and forwards them as Pushcut notifications, which play a custom sound on iOS.

Request flow on `POST /webhook`:
1. `express.json` parses the body while a `verify` callback stashes the raw bytes on `req.rawBody`. The raw bytes — not the re-serialized JSON — must be used for signature verification; changing the JSON middleware or reading the body elsewhere first will break HMAC checks.
2. `verifyTodoist` computes `HMAC-SHA256(TODOIST_CLIENT_SECRET, rawBody)` (base64) and compares to the `x-todoist-hmac-sha256` header with `crypto.timingSafeEqual`. The length check guards the compare since mismatched-length buffers would throw.
3. The handler **acks 200 immediately**, then does work asynchronously. Todoist retries on timeout or non-200, so downstream failures (Todoist REST outage, Pushcut outage) must not delay or fail the ack. Do not move the API calls before `res.status(200)`.
4. Only `reminder:fired` events are processed. The reminder payload contains `item_id` but **not** the task content, so the handler does a `GET /api/v1/tasks/{item_id}` lookup against the Todoist API to get the content, then POSTs to the Pushcut notification endpoint. (Todoist deprecated the old `/rest/v2/` and `/sync/v9/` prefixes in favor of the unified `/api/v1/`.)

## Reminder semantics

`reminder:fired` only fires if a reminder exists on the task. Todoist auto-creates one when a task has a **due time** (e.g. "tomorrow at 3pm") but not when it only has a date. Date-only tasks will not trigger this flow.

## Notification routing

Every reminder fires to **one** Pushcut notification (`PUSHCUT_NOTIFICATION_NAME`);
the **sound** is chosen per task and sent in the payload. This works because a
payload `sound` overrides the notification's configured sound — so there is no
need for a separate Pushcut notification per tier (that was the old model).

`routeNotification(task)` (in `routes.js`) returns `{ sound, label }`. Routing is a
**declarative first-match-wins table** — the `RULES` array in `routes.js` is the ONE
place to edit. Each rule has an optional `when(task)` predicate and sets a `sound`
(Pushcut sound; `''` = the notification's own configured sound) and a `label` (the
subtitle tier tag). The last rule (no `when`) is the catch-all default.

**Precedence is rule order.** As shipped, the **priority (P1) rule is checked first**,
so a P1 task is always urgent/critical even if it also carries a label; the label
rules (`bill`, `health`, `errand`) apply to non-P1 tasks. Reorder to change this.

**Todoist's API priority is inverted vs the UI: API `4` === UI "P1" (urgent).**

To add a new alert type — **one line, no new Pushcut notification**:
1. Add a rule to `RULES` in `routes.js` — match on `task.labels`, `task.priority`,
   `task.project_id`, `task.content`, etc. (`hasLabel(task, 'name')` helper provided)
   and give it a `sound` + `label`.
2. Deploy. Built-in Pushcut sounds (`vibrateOnly`, `system`, `subtle`, `question`,
   `jobDone`, `problem`, `loud`, `lasers`) need no setup; a custom sound must be
   imported into the Pushcut app by name on the receiving device.

## Critical alerts (urgent tier → Pushover)

An iOS **Critical Alert** (pierces the physical mute switch + Do Not Disturb) can
only be sent by an app holding Apple's Critical Alerts entitlement. **Pushcut does
NOT have it** (Apple refused it), so Time-Sensitive is the most Pushcut can do —
and that still respects the mute switch. **Pushover DOES have the entitlement**, so
the urgent tier is routed through Pushover instead.

A rule with **`critical: true`** in `routes.js` (currently priority 4 / UI P1) is
sent via `sendPushover()` — `POST https://api.pushover.net/1/messages.json` with
`priority=1` (delivered as a Critical Alert once the user enables Critical Alerts
on-device; no ack required). Pushover has **no per-message "critical" flag** — it's
`priority` (1 high or 2 emergency) **plus** the on-device Critical-Alerts setting.

- If `PUSHOVER_TOKEN`/`PUSHOVER_USER_KEY` are **unset or the call fails**, the tier
  **falls back to Pushcut** (using the rule's `sound`), so nothing goes silent.
- The rule's `sound` is therefore the *Pushcut fallback* sound; the Pushover sound
  is `PUSHOVER_SOUND` (default `siren`).
- **Precedence:** the priority rule runs **first**, so a P1 task is always critical
  even if it also carries a label. (Reorder `RULES` to change this.)
- `priority=2` (emergency, repeat-until-ack) is available via `PUSHOVER_PRIORITY=2`
  (+ `PUSHOVER_RETRY`/`PUSHOVER_EXPIRE`).

`GET /` is a health check (used by Railway; returns `todoist-router ok`).

## Environment variables

- `TODOIST_CLIENT_SECRET` — shared secret for webhook HMAC verification (Todoist App Console).
- `TODOIST_API_TOKEN` — personal API token used to look up task content by `item_id` (Todoist → Settings → Integrations → Developer).
- `PUSHCUT_API_KEY` — Pushcut account API key.
- `PUSHCUT_NOTIFICATION_NAME` — the single Pushcut notification every reminder fires to (defaults to `TodoistTaskReminder`). Per-task sounds are set in `routes.js`, not via env vars.
- `PUSHOVER_TOKEN` / `PUSHOVER_USER_KEY` — app token + user key for the critical (urgent) tier. If unset, the urgent tier falls back to Pushcut (non-critical).
- `PUSHOVER_SOUND` (default `siren`), `PUSHOVER_PRIORITY` (default `1`; `2` = emergency), `PUSHOVER_RETRY`/`PUSHOVER_EXPIRE` (priority 2 only) — optional Pushover tuning.
- `PORT` — optional; Railway sets this automatically, defaults to 3000 locally.

## Deploy (Railway)

1. `railway init` (or connect the repo in the Railway dashboard). `railway.json` sets the
   build/start/healthcheck; no Dockerfile needed (Nixpacks detects Node).
2. Add the env vars above as service **Variables**.
3. Deploy, copy the public URL, and register `https://<url>/webhook` as a Todoist webhook
   (event `reminder:fired`) in the **App Management console**
   (https://app.todoist.com/app/settings/integrations/app-management). The app's
   **Client secret** must match `TODOIST_CLIENT_SECRET`.
4. Reminders only fire on tasks that HAVE a reminder — on Todoist Pro, enable
   **Settings → Reminders → Automatic reminders** so timed tasks get one automatically.
