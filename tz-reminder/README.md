# T/Z Task Manager — daily reminder emails

Finds today's items in a task list and emails Zach and Taylor each a reminder of
**their own** tasks, plus the day's shared standing tasks and dinner. No AI —
pure text parsing. Runs at **7:00 AM** every day.

Each person sees only what's assigned to them (or to both) — there's no
"here's what your partner is doing" section.

## Two versions

| Version | Source | Where it runs | When to use |
|---------|--------|---------------|-------------|
| **`tz_reminder.gs`** (LIVE) | Google Doc "T/Z Task Manager" | Google's servers (Apps Script) | The real deal — fires at 7 AM even if your Mac is off. Sends straight from Gmail; no app password. |
| `tz_reminder.py` | Apple Note "T/Z Task Manager" | Your Mac (manual) | Legacy/local only. Older, simpler note format (no standing/dinner sections). Not scheduled. |

**The Apps Script version is the live, scheduled one** — the rest of this README
describes it. The Python version is kept as a local fallback; see
[Python version](#python-version-legacy) at the bottom.

## How the Doc is laid out

The Doc starts with a **date** (a date smart chip or typed date — used by the
freshness guard, below), a title, and a short legend. Then one section per
weekday:

```
Aug 2, 2026            ← date at top (freshness guard reads this)

T/Z Task Manager       ← title
<legend>

Monday                 ← weekday heading
• Grocery day          ← loose bullets = STANDING shared tasks (go to both)
• Laundry day
  Todos                ← subheading: tagged personal tasks
  • Call plumber @both
  • Daycare drop-off @taylor
  • Trash out @zach
  Dinner               ← subheading: tonight's dinner (shared)
  Chicken Kiev

Tuesday
...
```

Rules:
- **Weekday headings** are `Monday` … `Sunday`. A **`Daily`** heading applies its
  items to *every* day.
- **Loose bullets directly under a weekday** (before any subheading) are
  **standing shared tasks** — they go to *both* people and appear first in the
  email. Put a task under `Daily` to have it show every day.
- **`Todos`** subheading holds tagged personal tasks. Tag each one:
  `@zach`/`@z`, `@taylor`/`@t`, `@both`/`@us`.
- **`Dinner`** subheading holds tonight's dinner (one line, shared).
- **Untagged todos** aren't assigned to anyone — they're flagged in both emails
  under an "Untagged" heading so you know to tag them.

**Email order:** Standing weekly tasks → Dinner tonight → *<Name>*'s todos →
(any untagged) → link to the Doc.

## Freshness guard (don't re-send a stale list)

To avoid re-sending a week-old list if you forget to update the Doc, the
scheduled 7 AM run only fires while the list is fresh: today must be within
`freshness.maxDays` (7) of the **date at the top of the Doc**.

**The date must be TYPED TEXT** (e.g. `Aug 6, 2026`, `2026-08-06`, or
`8/6/2026`) — **not a date smart chip**. Apps Script's `getText()` cannot read
smart chips, so a chip reads as "no date".

The guard **fails closed**: if there's no readable, fresh date at the top, the
scheduled send is **skipped** (it does *not* guess from the Doc's last-edited
time — any edit, even setting an old date to pause, would refresh that and
defeat the guard). Practical upshots:
- To **pause** emails, set the date to more than 7 days ago (or remove it).
- To **resume**, type a current date at the top each week.
- If emails unexpectedly stop, check that the top date is *typed text* and
  within 7 days — a smart chip is the usual culprit.

**Manual sends** from the "T/Z Tasks" menu always go through, regardless of
freshness.

## One-time setup (live version)

Bind the script to the Doc so you also get a one-click **"T/Z Tasks"** menu.

1. Create/open the **T/Z Task Manager** Google Doc, signed in as the account
   emails should come **from** (`zachbines@gmail.com`).
2. In the Doc: **Extensions → Apps Script**. Delete the sample code, paste in all
   of `tz_reminder.gs`, **Save**.
3. Check the `CONFIG` block (emails, `testMode`) and set the project timezone:
   **Project Settings (⚙️) → Time zone**.
4. Run the **`setup`** function once (**Run ▸ setup**) and approve the prompt. It
   stores the Doc, writes the starter template if the Doc is empty, and installs
   the **daily 7 AM trigger**.
5. Reload the Doc → a **"T/Z Tasks"** menu appears (**Send today's tasks now**,
   **Preview today**, **Push today to Todoist**).

### Config quick reference (`CONFIG` in `tz_reminder.gs`)
- `people.*.email` — recipient addresses (currently `+tzmanager` aliases).
- `testMode: true` — redirects **Taylor's** email to
  `zachbines+fortayloractually@gmail.com` and prefixes subjects with `[TEST]`.
  Set `false` to email Taylor for real.
- `freshness.maxDays` — staleness window (default 7).
- `todoist.*` — optional push (see below).

## Previewing / sending

- **Menu → Preview today** or run `previewToday()` — logs the emails, sends
  nothing.
- **Menu → Send today's tasks now** or run `sendNow()` — sends immediately
  (bypasses the freshness guard).
- The 7 AM trigger calls `sendDailyReminders()` — obeys the freshness guard.

## Optional: push to Todoist

The script can mirror a person's tagged todos into **Todoist** as tasks with due
times (standing tasks and dinner are *not* pushed). This feeds the
`todoist-router` service, which turns Todoist reminders into Pushcut
notifications.

- Configure `todoist.pushFor` (whose tasks to push), `projectId`, `defaultTime`.
- The API token is read from **Script Properties** (key `TODOIST_TOKEN`), not
  from `CONFIG`: **Project Settings ⚙ → Script Properties → add TODOIST_TOKEN**
  (get it from Todoist → Settings → Integrations → Developer → API token).
- Times in item text (e.g. `Dentist 3pm`) become the task's due time and are
  stripped from the task name; items without a time use `todoist.defaultTime`.
- Run via **Menu → Push today to Todoist** (`menuPushTodoist`).

---

## Python version (legacy)

`tz_reminder.py` reads an **Apple Note** and sends via Gmail SMTP. It predates the
standing/dinner Doc structure and the own-tasks-only emails — treat it as a local
fallback, not a match for the live behavior.

### Gmail app password
The Python version sends through Gmail SMTP and needs a 16-character *app
password* (not your normal password), which requires 2-Step Verification:
1. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
2. Create an app password: https://myaccount.google.com/apppasswords
3. Paste it into `config.json` → `smtp.app_password`. (`config.json` is
   gitignored; copy from `config.example.json`.)

`smtp.user` / `smtp.from_email` must be the Gmail account the app password
belongs to. `test_mode: true` redirects Taylor's email to the test inbox and
prefixes `[TEST]`.

### macOS Notes access
The first time it reads Notes, macOS prompts *"…wants to control Notes."* Click
**OK** (or grant it under **System Settings → Privacy & Security → Automation**).

### Running
```bash
cd /Users/zachbines/ai-learning/zb-ai-assistant/tz-reminder
python3 tz_reminder.py --dry-run            # preview today, send nothing
python3 tz_reminder.py --dry-run --day Tuesday
python3 tz_reminder.py                        # actually send today's emails
```

## Files
| File | Purpose |
|------|---------|
| `tz_reminder.gs` | **Live version** — Apps Script: Google Doc → parse → email, 7 AM daily; optional Todoist push |
| `tz_reminder.py` | Legacy local version — Apple Note → parse → Gmail SMTP |
| `config.json` | Settings + app password for the Python version (gitignored) |
| `config.example.json` | Template to copy from |
| `com.zachbines.tz-reminder.plist` | Old launchd schedule for the Python version (no longer loaded) |
