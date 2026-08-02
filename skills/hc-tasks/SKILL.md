---
name: hc-tasks
description: Parse and list tasks/action items from Gmail emails labeled "HC". Use when the user asks to see tasks, action items, or to-dos from their HC-labeled emails.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task
---

# HC Task Grabber

## Goal
Fetch all Gmail emails labeled `HC`, extract concrete action items via parallel `task-extractor` subagents, and print a grouped task list to the terminal.

## Scripts
- `./scripts/hc_tasks_fetch.py` — Fetch HC-labeled emails with decoded body text
- `./scripts/hc_tasks_print.py` — Merge extracted task chunks and print grouped list

Chunking reuses the existing `gmail-label` splitter:
- `../gmail-label/scripts/gmail_label_split.py`

## Subagent
- `task-extractor` — defined in `agents/task-extractor.md`
- Model: Sonnet 4.5
- Reads one email chunk, writes one `tasks_N.json` array

## Flow

### Step 1: Fetch HC emails (with body)
```bash
python3 .claude/skills/hc-tasks/scripts/hc_tasks_fetch.py \
  --account ACCOUNT --limit 100 --output .tmp/hc_emails.json
```

### Step 2: Split into chunks
```bash
python3 .claude/skills/gmail-label/scripts/gmail_label_split.py \
  --input .tmp/hc_emails.json --chunks 5 --output-dir .tmp/hc_chunks
```
Use fewer chunks than gmail-label (5 vs 10) because bodies are larger and per-email reasoning is heavier.

### Step 3: Extract tasks in parallel
Spawn one `task-extractor` subagent per chunk with the Task tool:
- `subagent_type: "task-extractor"`
- `model: "sonnet"`
- `run_in_background: true`
- Prompt: `Read /absolute/path/.tmp/hc_chunks/chunk_N.json, extract tasks, write /absolute/path/.tmp/hc_chunks/tasks_N.json`

Launch all subagents in a single message for real parallelism. Do NOT use `TaskOutput` to read results — the subagents write to files. Poll for file existence instead:

```bash
for i in $(seq 0 4); do
  while [ ! -f ".tmp/hc_chunks/tasks_$i.json" ]; do sleep 2; done
done
```

### Step 4: Merge and print
```bash
python3 .claude/skills/hc-tasks/scripts/hc_tasks_print.py \
  --input-dir .tmp/hc_chunks --group-by priority
```

Options:
- `--group-by priority|sender|none` (default: priority)
- `--no-color` to disable ANSI colors
- `--save-json PATH` to also dump merged tasks as JSON

## Account Registry
Accounts live in `gmail_accounts.json` at the workspace root (same registry as `gmail-label`). Add new accounts with:
```bash
python3 .claude/skills/gmail-inbox/scripts/gmail_multi_auth.py --account ACCOUNT_NAME --email EMAIL
```

## Notes
- The fetch script pulls full MIME bodies and truncates each to 4000 chars to keep chunk sizes reasonable.
- If an email has no tasks, the extractor simply omits it — empty chunks return `[]`.
- The Gmail query is hardcoded to `label:HC`. Edit `hc_tasks_fetch.py` if the label name changes.
