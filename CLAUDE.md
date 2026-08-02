# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A collection of custom Claude Code subagent definitions. Each file in `agents/` defines a reusable subagent that can be spawned via the `Agent` tool in Claude Code sessions.

## Agent File Format

Every agent is a Markdown file with YAML frontmatter:

```markdown
---
name: agent-name           # identifier used when spawning
description: one-liner     # shown in agent picker; should be specific enough to match intent
model: sonnet|opus|haiku   # model to use
tools: Read, Write, Bash   # comma-separated list of tools the agent has access to
---

# Agent body (instructions for the agent)
```

The `description` field is used by Claude Code to decide *which* agent to spawn — make it precise.

## Agents in This Repo

| File | Purpose |
|------|---------|
| `code-reviewer.md` | Stateless code review: correctness, readability, performance, security |
| `email-classifier.md` | Classifies Gmail email chunks into Action Required / Waiting On / Reference |
| `qa.md` | Generates and runs tests for a code snippet, reports pass/fail |
| `research.md` | Deep web + file research; returns structured findings to a parent agent |

## Design Conventions

- **Agents are stateless** — they receive all context via the prompt (file paths, inline code). Do not assume they can read prior conversation.
- **Input/output via files** — agents typically receive a chunk/input file path and an output file path in their prompt, then read/write those files rather than returning large content inline.
- **Minimal tool grants** — only give an agent the tools it actually needs. `Read`+`Write` for classifiers; add `Bash` only if it must execute code.
- **Output format is strict** — each agent specifies an exact output schema (JSON, structured Markdown). Keep these unambiguous so the parent agent can parse results reliably.
