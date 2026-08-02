#!/usr/bin/env python3
"""
Merge extracted task chunks and print a grouped task list to the terminal.

Usage:
    python3 .claude/skills/hc-tasks/scripts/hc_tasks_print.py \
        --input-dir .tmp/hc_chunks --group-by priority
"""

import os
import sys
import json
import glob
import argparse
from collections import defaultdict


PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
COLORS = {
    "high": "\033[91m",
    "medium": "\033[93m",
    "low": "\033[90m",
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "cyan": "\033[36m",
}


def load_tasks(input_dir: str) -> list[dict]:
    tasks = []
    for path in sorted(glob.glob(os.path.join(input_dir, "tasks_*.json"))):
        try:
            with open(path) as f:
                data = json.load(f)
            if isinstance(data, list):
                tasks.extend(data)
        except Exception as e:
            print(f"Warning: failed to read {path}: {e}", file=sys.stderr)
    return tasks


def sort_key(task: dict):
    pri = PRIORITY_ORDER.get((task.get("priority") or "low").lower(), 3)
    due = task.get("due") or "￿"
    return (pri, due)


def print_grouped(tasks: list[dict], group_by: str, use_color: bool):
    def c(key: str) -> str:
        return COLORS[key] if use_color else ""

    if not tasks:
        print("No tasks found.")
        return

    if group_by == "priority":
        groups = defaultdict(list)
        for t in tasks:
            groups[(t.get("priority") or "low").lower()].append(t)
        ordered = sorted(groups.keys(), key=lambda k: PRIORITY_ORDER.get(k, 3))
    elif group_by == "sender":
        groups = defaultdict(list)
        for t in tasks:
            groups[t.get("from") or "(unknown sender)"].append(t)
        ordered = sorted(groups.keys(), key=lambda k: k.lower())
    else:
        groups = {"All tasks": tasks}
        ordered = ["All tasks"]

    total = len(tasks)
    print(f"\n{c('bold')}HC Task List — {total} task{'s' if total != 1 else ''}{c('reset')}\n")

    for group in ordered:
        items = sorted(groups[group], key=sort_key)
        header_color = c(group) if group_by == "priority" and group in COLORS else c("cyan")
        print(f"{header_color}{c('bold')}{group.upper() if group_by == 'priority' else group}{c('reset')}  {c('dim')}({len(items)}){c('reset')}")
        for t in items:
            due = t.get("due")
            due_str = f" {c('dim')}· due {due}{c('reset')}" if due else ""
            pri = (t.get("priority") or "").lower()
            pri_tag = f" {c(pri)}[{pri}]{c('reset')}" if group_by != "priority" and pri in COLORS else ""
            subject = t.get("subject", "")
            sender = t.get("from", "")
            print(f"  • {t.get('task', '').strip()}{due_str}{pri_tag}")
            meta_bits = []
            if subject:
                meta_bits.append(f"re: {subject}")
            if sender and group_by != "sender":
                meta_bits.append(f"from {sender}")
            if meta_bits:
                print(f"    {c('dim')}{' · '.join(meta_bits)}{c('reset')}")
        print()


def main():
    parser = argparse.ArgumentParser(description="Merge and print extracted HC tasks")
    parser.add_argument("--input-dir", "-i", required=True, help="Directory containing tasks_*.json chunk outputs")
    parser.add_argument("--group-by", "-g", choices=["priority", "sender", "none"], default="priority")
    parser.add_argument("--no-color", action="store_true")
    parser.add_argument("--save-json", help="Optional path to also write merged tasks as JSON")
    args = parser.parse_args()

    tasks = load_tasks(args.input_dir)
    use_color = not args.no_color and sys.stdout.isatty()
    print_grouped(tasks, args.group_by, use_color)

    if args.save_json:
        os.makedirs(os.path.dirname(args.save_json) or ".", exist_ok=True)
        with open(args.save_json, "w") as f:
            json.dump(tasks, f, indent=2)
        print(f"(saved merged tasks to {args.save_json})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
