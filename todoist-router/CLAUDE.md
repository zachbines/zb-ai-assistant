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

After the task lookup, `routeNotification(task)` picks which Pushcut notification to
fire based on priority. **Todoist's API priority is inverted vs the UI: API `4` ===
UI "P1" (urgent).** Priority 4 → `PUSHCUT_URGENT_NOTIFICATION_NAME`; everything else →
`PUSHCUT_NOTIFICATION_NAME`. Each Pushcut notification carries its own sound (configured
in the Pushcut app, not here), so different tiers = different sounds.

`GET /` is a health check (used by Railway; returns `todoist-router ok`).

## Environment variables

- `TODOIST_CLIENT_SECRET` — shared secret for webhook HMAC verification (Todoist App Console).
- `TODOIST_API_TOKEN` — personal API token used to look up task content by `item_id` (Todoist → Settings → Integrations → Developer).
- `PUSHCUT_API_KEY` — Pushcut account API key.
- `PUSHCUT_NOTIFICATION_NAME` — normal-task Pushcut notification name (defaults to `TodoistTaskReminder`).
- `PUSHCUT_URGENT_NOTIFICATION_NAME` — urgent (P1) Pushcut notification name (defaults to `UrgentTask`).
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
