# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

`zb-ai-assistant` is a **monorepo** of personal AI-assistant tooling. It holds four kinds of things:

| Directory | What it is |
|-----------|-----------|
| `agents/` | Custom Claude Code **subagent** definitions (spawned via the `Agent` tool). |
| `skills/` | Packaged **skills** — a `SKILL.md` playbook plus `scripts/` — invoked via the `Skill` tool. |
| `tz-reminder/` | **Service:** daily task-reminder emails (Google Apps Script + Python fallback). |
| `todoist-router/` | **Service:** Todoist `reminder:fired` webhook → priority/label-routed Pushcut notifications (Node/Express on Railway). |

See `README.md` for the user-facing how-to on the services and a catalog of every skill/agent.

## Git & secrets

Single repo, single history (`github.com/zachbines/zb-ai-assistant`). One **root `.gitignore`** protects every secret — never commit `todoist-router/.env` or `tz-reminder/config.json`. Templates (`.env.example`, `config.example.json`) are the committed stand-ins. Before adding any new tool that needs credentials, add its secret file to the root `.gitignore` and commit only an example template.

## Agents (`agents/`)

Each agent is a Markdown file with YAML frontmatter:

```markdown
---
name: agent-name           # identifier used when spawning
description: one-liner      # shown in the agent picker; must be precise enough to match intent
model: sonnet|opus|haiku    # model to use
tools: Read, Write, Bash    # comma-separated tools the agent may use
---

# Agent body (instructions for the agent)
```

The `description` drives *which* agent Claude Code spawns — keep it specific.

**Conventions:**
- **Stateless** — agents get all context via the prompt (file paths, inline code). They can't see prior conversation.
- **Input/output via files** — agents usually receive an input-chunk path and an output path, then read/write those instead of returning large content inline.
- **Minimal tool grants** — grant only what's needed (`Read`+`Write` for classifiers; add `Bash` only to run code).
- **Strict output schema** — each agent specifies an exact output format (JSON / structured Markdown) so the parent can parse it.

## Skills (`skills/`)

Each skill is a directory with a `SKILL.md` (frontmatter `name` + `description`, then the playbook) and usually a `scripts/` folder of Python it drives. The `description` states *when* to invoke — Claude matches the user's intent against it. Skills are invoked with the `Skill` tool (or `/name`).

**Conventions:**
- **`SKILL.md` is the entry point** — it documents inputs, the step sequence, and which scripts to run.
- **Scripts are runnable standalone** — parameterized via args/env, no hidden state.
- **Credentials via env/config**, never hardcoded (same secret rules as above).

## Services

Each service has its own `CLAUDE.md` with architecture and deploy detail:
- `tz-reminder/` — element-based Google Doc parsing, freshness guard, Gmail send, optional Todoist push. Live version is the Apps Script (`tz_reminder.gs`), bound to the Doc.
- `todoist-router/CLAUDE.md` — webhook HMAC verification, ack-before-work, and the **declarative Pushcut routing table** in `routes.js` (the one place to add new alert types).
