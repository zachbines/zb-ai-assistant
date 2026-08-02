# Todoist → iOS Custom Sound Automation

## Goal

When a high-priority task is added in Todoist, automatically play a custom notification sound on my iPhone. No manual polling, no third-party automation platforms (IFTTT, Zapier). Fully self-hosted on Railway.

## Architecture

```
Todoist webhook (item:added)
  → Railway-hosted Express server (Node 18+)
    → Filters by project ID or "HighPriority" label
    → Sends email to Apple ID inbox via Resend API
      → iOS Shortcut / Mail rule triggers custom sound
```

## What's built

- Express webhook server (`index.js` + `package.json`), ready to deploy to Railway
- HMAC signature verification using `X-Todoist-Hmac-SHA256` header and raw body capture
- Resend email integration (sends on matching task)
- Fast 200 ack before async email send to avoid Todoist retry/timeout
- Filter logic: matches on `TARGET_PROJECT_ID` or a `HighPriority` label (label names are strings in Todoist's webhook payload)

## Railway env vars needed

| Variable | Purpose |
|---|---|
| `TARGET_PROJECT_ID` | Todoist project ID to watch |
| `TODOIST_CLIENT_SECRET` | From Todoist App Console; used for HMAC verification |
| `RESEND_API_KEY` | Resend API key |
| `MAIL_FROM` | Resend-verified sender address |
| `NOTIFY_EMAIL` | Apple ID inbox that receives the trigger email |

## What's not done / open questions

1. **iOS trigger mechanism is unverified.** iOS Shortcuts does not have a native "email received" personal automation trigger. The email-to-sound hop likely needs one of:
   - A Mail rule + Pushcut or similar push notification bridge
   - Replacing email entirely with a push notification service (ntfy, Pushover, Pushcut)
   - Some other approach from Poke's automation layer
   This is the main gap to solve.

2. **Resend sender domain.** `onboarding@resend.dev` works for testing (delivers to your own Resend account email only). Production use needs a verified custom domain.

3. **Railway cost.** Not actually free. The free plan gives $1/mo in credits; an always-on service can exceed that. Hobby plan is $5/mo. App sleeping may help keep costs under $1 if webhook traffic is low.

4. **Not yet deployed.** Code is written but not pushed to a repo or deployed to Railway yet.

5. **Scope expansion possibilities:**
   - Additional event types beyond `item:added` (e.g., `item:updated` for priority changes)
   - Multiple notification tiers (different sounds for different labels/projects)
   - Logging/monitoring for missed webhooks

## Origin

This came from a conversation with Poke (iOS automation assistant) who proposed the architecture. The Express server code and deploy steps were built out in a Claude session on 2026-06-06.
