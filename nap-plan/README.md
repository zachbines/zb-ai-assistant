# Nap Plan

A one-page web app for planning a baby's day sleep. Set wake-up time, bedtime,
number of naps and a day-sleep goal; the naps and awake windows lay out on a
timeline you can drag. **Send to Todoist** turns the plan into timed tasks
labeled `nap`, which `todoist-router` delivers to your phone with the gentle
nap sound.

- `public/index.html` — the whole app (no build step, no libraries). The plan
  is saved in the browser, per device.
- `server.js` — serves the page and adds the Todoist tasks
  (`POST /api/todoist/tasks`) using your Todoist API token. No dependencies;
  needs Node 18+ for `fetch`.

## Run locally

```bash
cd nap-plan
cp .env.example .env    # fill in both values
node --env-file=.env server.js
# open http://localhost:3000
```

## Deploy on Railway

1. In Railway, **New → GitHub repo → zb-ai-assistant**.
2. In the new service's **Settings → Root Directory**, enter `nap-plan`
   (`railway.json` there sets the start command and health check).
3. Under **Variables**, add:
   - `TODOIST_API_TOKEN` — the same token todoist-router uses.
   - `NAP_PLAN_PASSCODE` — any passcode you choose.
4. **Settings → Networking → Generate Domain** to get the public URL.
5. Open the URL on your phone. The first time you press **Add reminders to
   Todoist** it asks for the passcode, then remembers it on that device.
   Tip: Safari → Share → **Add to Home Screen** makes it feel like an app.

## How sending works

The page sends only the task names, due times ("today at 9:05am" /
"tomorrow at …") and nap lengths. The server checks the passcode, rebuilds each
task itself (always the `nap` label, always the Inbox) and creates them one at a
time, so if Todoist fails part-way the page can say exactly how many were added.
Ten wrong passcodes in 10 minutes locks sending for the rest of that window.

Sending the same day twice adds a second set (the page warns first). Delete the
old tasks in Todoist if the plan changed.
