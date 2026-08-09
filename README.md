# zb-ai-assistant

A personal monorepo of AI-assistant tooling: two always-on **services**, plus a
library of **skills** and **subagents** used inside Claude Code sessions.

```
zb-ai-assistant/
├── agents/          # Claude Code subagent definitions (spawned via the Agent tool)
├── skills/          # Packaged skills — SKILL.md playbook + scripts/ (Skill tool / /name)
├── tz-reminder/     # SERVICE: daily task-reminder emails
├── todoist-router/  # SERVICE: Todoist reminders → Pushcut notifications
└── CLAUDE.md        # Guidance for Claude Code working in this repo
```

Secrets live in gitignored `.env` / `config.json` files; only `*.example`
templates are committed. See [Secrets](#secrets).

---

## Services

### 1. tz-reminder — daily task-reminder emails

Reads a **Google Doc** ("T/Z Task Manager") laid out with weekday headings and
tagged bullets, and emails Zach and Taylor each morning at **7:00 AM** with the
day's standing tasks, dinner, and their own to-dos. **No AI — deterministic text
parsing.**

- **Live version:** `tz_reminder.gs` (Google Apps Script) — runs on Google's
  servers, so it fires even when the laptop is off. Bind it to the Doc
  (**Extensions → Apps Script**) to get the one-click **"T/Z Tasks"** menu.
- **Local fallback:** `tz_reminder.py` — reads an Apple Note, sends via Gmail
  SMTP. For local testing only; not scheduled.

**How to run / set up:** see [`tz-reminder/README.md`](tz-reminder/README.md).
Quick reference:
- Doc menu → **Preview today** (no send) / **Send today's tasks now**.
- `previewToday()` logs the emails; `sendNow()` sends immediately; the 7 AM
  trigger calls `sendDailyReminders()` (respects the freshness guard).
- `testMode: true` in `CONFIG` redirects Taylor's email to a test inbox.

**Optional Todoist push:** the script can turn a person's tagged items into
Todoist tasks with due times — which then feed the router below.

### 2. todoist-router — Todoist reminders → Pushcut

An Express webhook service (deployed on **Railway**) that receives Todoist
`reminder:fired` events and fires a **Pushcut** notification on iOS, choosing the
**sound** by the task's labels/priority.

**Flow:** Todoist reminder → `POST /webhook` → HMAC-verify → ack `200` →
look up the task → `routeNotification()` picks a **sound + label** → send to one
Pushcut notification.

Everything fires to a single Pushcut notification (`PUSHCUT_NOTIFICATION_NAME`);
the per-task sound is set in the payload (a payload `sound` overrides the
notification's configured sound), so there's no separate notification per tier.

**Adding a new alert type is a one-line data edit** in
[`todoist-router/routes.js`](todoist-router/routes.js) — a first-match-wins table.
Each rule matches on `task.labels` / `task.priority` / `task.project_id` /
`task.content` and sets a `sound` + subtitle `label`:

```js
{ when: (t) => hasLabel(t, 'bill'), sound: 'problem', label: '💸 Bill due' },
```

Steps to add one: add a rule to `RULES` → deploy. **No new Pushcut notification
needed** — built-in sounds work as-is; custom sounds must be imported into Pushcut
by name. **Rule order = precedence** (label rules are checked before the priority
tier as shipped). Full detail: [`todoist-router/CLAUDE.md`](todoist-router/CLAUDE.md).

**Run / deploy:**
```bash
cd todoist-router
npm install
npm start            # local, needs .env (copy .env.example)
```
Deploy: Railway service pointed at this repo with **Root Directory =
`todoist-router/`**; set the env vars from `.env.example` as service Variables;
register `https://<url>/webhook` as a Todoist webhook for `reminder:fired`.
Reminders only fire on tasks with a **due time** — on Todoist Pro, enable
**Settings → Reminders → Automatic reminders**.

---

## Skills (`skills/`)

Invoked with the `Skill` tool or `/name` when the user's request matches the
skill's purpose. Each is a `SKILL.md` playbook plus a `scripts/` folder.

### Lead generation & outreach
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `scrape-leads` | Find/scrape business leads (Apify), classify, enrich emails, save to Sheets — any industry/location. |
| `gmaps-leads` | Scrape Google Maps for local B2B leads with website enrichment + contact extraction. |
| `classify-leads` | Classify/filter leads by type (e.g. SaaS vs agency) using an LLM. |
| `casualize-names` | Convert formal first/company/city names to casual forms for cold-email personalization. |
| `instantly-campaigns` | Create cold-email campaigns with A/B testing in Instantly. |
| `instantly-autoreply` | Auto-generate replies to inbound Instantly threads from a knowledge base. |
| `upwork-apply` | Scrape Upwork jobs and generate personalized proposals/cover letters. |

### Client delivery
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `create-proposal` | Generate a PandaDoc proposal/quote from client info or a call transcript. |
| `design-website` | Generate a premium mockup website for a prospect. |
| `onboarding-kickoff` | Run post-kickoff automation: leads + campaigns + auto-reply for a new client. |
| `welcome-email` | Send the welcome-email sequence to a new client. |

### Email & inbox
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `gmail-inbox` | Read/label/archive email across multiple Gmail accounts (unified). |
| `gmail-label` | Auto-triage inbox into Action Required / Waiting On / Reference (uses `email-classifier`). |
| `hc-tasks` | List tasks/action items from "HC"-labeled Gmail (uses `task-extractor`). |

### YouTube & video content
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `youtube-outliers` | Find viral videos in your niche for competitive intel. |
| `cross-niche-outliers` | Find viral videos in adjacent niches for content patterns/hooks. |
| `title-variants` | Generate YouTube title variants from outlier analysis. |
| `recreate-thumbnails` | Face-swap/recreate YouTube thumbnails. |
| `video-edit` | Edit talking-head video: remove silences (VAD) + add 3D teaser transitions. |
| `pan-3d-transition` | Add a 3D pan/swivel transition effect (Remotion). |

### Community (Skool)
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `skool-monitor` | Read/post/reply/like/search in Skool communities. |
| `skool-rag` | Query Skool content via a RAG pipeline with vector search. |

### Research & reporting
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `literature-research` | Search academic literature (PubMed) and do deep review. |
| `generate-report` | Generate a weekly Canada weather PDF (Open-Meteo). |

### Infrastructure & deploy
| Skill | Invoke when the user wants to… |
|-------|--------------------------------|
| `modal-deploy` | Deploy/update execution scripts on Modal cloud. |
| `add-webhook` | Add a new Modal webhook / event-trigger endpoint. |
| `local-server` | Run the orchestrator locally with a Cloudflare tunnel (test webhooks). |

---

## Agents (`agents/`)

Stateless subagents spawned via the `Agent` tool. They receive all context in the
prompt and typically read/write files rather than returning large content inline.

| Agent | When to spawn it |
|-------|------------------|
| `code-reviewer` | Unbiased review of a code snippet — correctness, readability, performance, security. Returns actionable recommendations. |
| `qa` | Generate tests for a snippet, run them, report pass/fail. Validate correctness before shipping. |
| `research` | Deep investigation needing many web/file searches — keeps the parent context clean. |
| `email-classifier` | Classify a chunk of Gmail into Action Required / Waiting On / Reference. Used by `gmail-label` for parallel classification. |
| `task-extractor` | Extract action items assigned to the user from a chunk of Gmail. Used by `hc-tasks` for parallel extraction. |

---

## Secrets

- **Never commit** `todoist-router/.env` or `tz-reminder/config.json` — the root
  `.gitignore` excludes them.
- Committed templates: `todoist-router/.env.example`, `tz-reminder/config.example.json`.
- Adding a new tool with credentials? Add its secret file to the root
  `.gitignore` and commit only an example template.
