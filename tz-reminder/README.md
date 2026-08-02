# T/Z Task Manager — daily reminder emails

Finds today's items in a task list and emails Zach and Taylor each a reminder of
their own tasks plus a heads-up about the other's. No AI — pure text parsing.
Runs at **7:00 AM** every day.

## Two versions

| Version | Source | Where it runs | When to use |
|---------|--------|---------------|-------------|
| **`tz_reminder.gs`** (LIVE) | Google Doc "T/Z Task Manager" | Google's servers (Apps Script) | The real deal — fires at 7 AM even if your Mac is off. |
| `tz_reminder.py` | Apple Note "T/Z Task Manager" | Your Mac (manual / `launchd`) | Local testing or a Mac-only setup. Not scheduled anymore. |

Both use the identical note format and email layout below. **The Apps Script
version is the scheduled one** — see "Cloud setup" at the bottom.

## How to write the note

In the Notes app, lay the note out with **weekday headings** and **tagged bullets**:

```
Monday
- Drop Noey at daycare @taylor
- Grocery run @zach
- Call plumber @both

Tuesday
- Trash out @zach
- Dentist 3pm @taylor
```

Rules:
- Headings are weekday names: `Monday` … `Sunday`.
- A `Daily` (or `Everyday`) heading applies its items to **every** day.
- Tag every item: `@zach`/`@z`, `@taylor`/`@t`, `@both`/`@us`.
- **Untagged items are not assigned to anyone** — they show up in both emails
  under an "Untagged" heads-up so you know to tag them.

## One-time setup

### 1. Create a Gmail app password
The tool sends through Gmail's SMTP. You need a 16-character *app password*
(not your normal password), which requires 2-Step Verification on the account.

1. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/two-step-verification
2. Create an app password: https://myaccount.google.com/apppasswords
3. Copy the 16-character value.

### 2. Fill in the config
Edit `config.json` and paste the app password into `smtp.app_password`.

- `smtp.user` / `smtp.from_email` must be the Gmail account the app password
  belongs to (currently `zachbines@gmail.com`).
- `test_mode: true` redirects **Taylor's** email to
  `zachbines+fortayloractually@gmail.com` and prefixes subjects with `[TEST]`.
  Flip it to `false` when you're ready to email Taylor for real.

`config.json` is gitignored so your password never gets committed.

### 3. Grant Notes access (important on macOS)
The first time the script reads Notes, macOS pops up
*"…wants to control Notes."* Click **OK**. Do this by running it manually once:

```bash
cd /Users/zachbines/ai-learning/zb-ai-assistant/tz-reminder
python3 tz_reminder.py --dry-run --day Monday
```

If you never see the prompt and it errors, grant it manually under
**System Settings → Privacy & Security → Automation**.

## Running it

```bash
# See what today's emails would look like — sends nothing
python3 tz_reminder.py --dry-run

# Pretend it's a specific day
python3 tz_reminder.py --dry-run --day Tuesday

# Actually send today's emails
python3 tz_reminder.py
```

# Cloud setup (the live 7 AM schedule) — `tz_reminder.gs`

This runs on Google's servers, so it fires at 7 AM even when your Mac is off.
It reads a **Google Doc** and sends straight from your Gmail — no app password
needed. Bind the script to the Doc so you also get a **"T/Z Tasks" menu** (a
one-click Send button) inside the Doc.

**Recommended: Doc-bound script (adds the in-Doc menu)**

1. Create/open the **T/Z Task Manager** Google Doc (signed in as the account
   emails should come **from**, `zachbines@gmail.com`).
2. In the Doc: **Extensions → Apps Script**. Delete the sample code and paste
   in all of `tz_reminder.gs`. **Save**.
3. Check the `CONFIG` block (emails, `testMode`) and set the project timezone:
   **Project Settings (⚙️) → Time zone**.
4. Run the **`setup`** function once (**Run ▸ setup**) and approve the prompt.
   It stores the Doc, writes the starter template if the Doc is empty, and
   installs the **daily 7 AM trigger**.
5. Reload the Doc → a **"T/Z Tasks"** menu appears with **Send today's tasks
   now** and **Preview today**.

**Preview / test:** use the menu, or run `previewToday` (logs only) / `sendNow`
(sends for real). To go live to Taylor's real inbox, set `testMode: false` in
`CONFIG`.

> If you set it up as a **standalone** script instead (script.google.com → New
> project), everything works the same *except* the in-Doc menu — `onOpen` menus
> require the script to be bound to the Doc. To add the menu later, move the code
> into the Doc's **Extensions → Apps Script**, run `setup` there, and delete the
> old standalone trigger so you don't get duplicate emails.

## Files
| File | Purpose |
|------|---------|
| `tz_reminder.gs` | **Live version** — Apps Script: Google Doc → parse → email, 7 AM daily |
| `tz_reminder.py` | Local version — Apple Note → parse → send via Gmail SMTP |
| `config.json` | Settings + app password for the Python version (gitignored) |
| `config.example.json` | Template to copy from |
| `com.zachbines.tz-reminder.plist` | Old launchd schedule for the Python version (no longer loaded) |
