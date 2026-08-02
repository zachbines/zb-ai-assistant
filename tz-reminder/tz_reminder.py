#!/usr/bin/env python3
"""
T/Z Task Manager — daily reminder emails for Zach & Taylor.

Reads an Apple Notes note (default: "T/Z Task Manager") that is laid out as
weekday headings with tagged bullet items, figures out today's items, and
emails each person their tasks plus a heads-up about the other's tasks.

No AI involved — pure deterministic parsing.

Note format expected (fill the note in like this):

    Monday
    - Drop Noey at daycare @taylor
    - Grocery run @zach
    - Call plumber @both

    Tuesday
    - Trash out @zach
    - Dentist 3pm @taylor

Rules:
  * Headings are weekday names (Monday..Sunday). A "Daily" / "Everyday"
    heading applies its items to every day of the week.
  * Each item is tagged with @zach/@z, @taylor/@t, or @both/@us.
  * Untagged items are NOT sent — they're surfaced as a heads-up line so you
    know you forgot to tag something.

Usage:
    python3 tz_reminder.py                 # send today's emails
    python3 tz_reminder.py --dry-run       # print what would be sent, send nothing
    python3 tz_reminder.py --day Tuesday   # pretend it's Tuesday (testing)
    python3 tz_reminder.py --config /path/to/config.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import smtplib
import subprocess
import sys
from email.message import EmailMessage
from pathlib import Path

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
DAILY_HEADINGS = {"daily", "everyday", "every day"}

# Tag token -> canonical owner
TAG_MAP = {
    "zach": "zach", "z": "zach",
    "taylor": "taylor", "t": "taylor",
    "both": "both", "us": "both",
}
TAG_RE = re.compile(r"@(" + "|".join(sorted(TAG_MAP, key=len, reverse=True)) + r")\b", re.IGNORECASE)

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


# --------------------------------------------------------------------------- #
# Reading the note
# --------------------------------------------------------------------------- #
def read_note_body(title: str) -> str:
    """Return the raw HTML body of the named Apple Notes note."""
    script = f'tell application "Notes" to get body of note "{title}"'
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise SystemExit("ERROR: timed out reading Notes. Is the Notes app responsive?")
    if result.returncode != 0:
        raise SystemExit(
            f"ERROR: could not read note {title!r} from Notes.\n"
            f"{result.stderr.strip()}\n"
            "If this is a permissions error, run the script once from Terminal and "
            "click 'OK' when macOS asks to allow controlling Notes."
        )
    return result.stdout


def html_to_lines(body: str) -> list[str]:
    """Convert Apple Notes HTML into a clean list of text lines."""
    text = body
    # Turn block-level boundaries into newlines.
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(div|p|li|h[1-6]|ul|ol)>", "\n", text)
    # Drop all remaining tags.
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    lines = []
    for raw in text.split("\n"):
        line = raw.replace(" ", " ").strip()
        if line:
            lines.append(line)
    return lines


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def _clean_heading(line: str) -> str:
    """Normalize a candidate heading: strip bullets and trailing punctuation."""
    s = line.strip().lstrip("-•*▪◦ ").strip()
    s = s.rstrip(":").strip()
    return s.lower()


def _strip_bullet(line: str) -> str:
    return line.lstrip("-•*▪◦ ").strip()


def parse_note(lines: list[str]) -> dict:
    """
    Return a dict:
      { weekday: {"zach": [...], "taylor": [...], "both": [...], "untagged": [...]} }
    'Daily' items are folded into every weekday.
    """
    days = {d: {"zach": [], "taylor": [], "both": [], "untagged": []} for d in WEEKDAYS}
    daily = {"zach": [], "taylor": [], "both": [], "untagged": []}

    current = None  # current bucket (a day dict, the daily dict, or None)
    for line in lines:
        heading = _clean_heading(line)
        if heading in WEEKDAYS:
            current = days[heading]
            continue
        if heading in DAILY_HEADINGS:
            current = daily
            continue
        if current is None:
            continue  # text before the first heading (e.g. the title)

        task, owner = extract_task(_strip_bullet(line))
        if not task:
            continue
        current[owner].append(task)

    # Fold daily items into every weekday.
    for d in WEEKDAYS:
        for owner in ("zach", "taylor", "both", "untagged"):
            days[d][owner] = daily[owner] + days[d][owner]

    return days


def extract_task(text: str) -> tuple[str, str]:
    """Return (task_text_without_tags, owner). owner in zach/taylor/both/untagged."""
    owners = set()
    for m in TAG_RE.finditer(text):
        owners.add(TAG_MAP[m.group(1).lower()])
    task = TAG_RE.sub("", text).strip()
    task = re.sub(r"\s{2,}", " ", task).strip(" -–—:")

    if not owners:
        owner = "untagged"
    elif "both" in owners or ("zach" in owners and "taylor" in owners):
        owner = "both"
    else:
        owner = owners.pop()
    return task, owner


# --------------------------------------------------------------------------- #
# Email composition
# --------------------------------------------------------------------------- #
def compose_for(person: str, partner: str, day_bucket: dict) -> tuple[list, list, list]:
    """
    Returns (mine, partners, untagged) task lists for `person`.
      mine     = person's own items + shared (both), shared marked "(shared)"
      partners = partner-only items (heads-up)
      untagged = items with no tag (heads-up)
    """
    mine = list(day_bucket[person]) + [f"{t} (shared)" for t in day_bucket["both"]]
    partners = list(day_bucket[partner])
    untagged = list(day_bucket["untagged"])
    return mine, partners, untagged


def render_plain(name: str, partner_name: str, weekday_label: str,
                 mine: list, partners: list, untagged: list) -> str:
    lines = [f"Good morning {name}! Here's your {weekday_label}.", ""]
    if mine:
        lines.append("YOUR TASKS")
        lines += [f"  • {t}" for t in mine]
    else:
        lines.append("YOUR TASKS")
        lines.append("  • Nothing on your list today 🎉")
    lines.append("")
    if partners:
        lines.append(f"HEADS UP — {partner_name.upper()} IS DOING")
        lines += [f"  • {t}" for t in partners]
        lines.append("")
    if untagged:
        lines.append("UNTAGGED (nobody assigned — tag these with @zach/@taylor/@both)")
        lines += [f"  • {t}" for t in untagged]
        lines.append("")
    lines.append("— T/Z Task Manager")
    return "\n".join(lines)


def render_html(name: str, partner_name: str, weekday_label: str,
                mine: list, partners: list, untagged: list) -> str:
    def ul(items):
        return "<ul>" + "".join(f"<li>{html.escape(i)}</li>" for i in items) + "</ul>"

    parts = [
        f"<div style='font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;color:#222'>",
        f"<p>Good morning <b>{html.escape(name)}</b>! Here's your {html.escape(weekday_label)}.</p>",
        "<h3 style='margin-bottom:4px'>Your tasks</h3>",
    ]
    parts.append(ul(mine) if mine else "<p>Nothing on your list today 🎉</p>")
    if partners:
        parts.append(f"<h3 style='margin-bottom:4px'>Heads up — {html.escape(partner_name)} is doing</h3>")
        parts.append(ul(partners))
    if untagged:
        parts.append("<h3 style='margin-bottom:4px;color:#a15c00'>Untagged</h3>")
        parts.append("<p style='color:#a15c00;margin:0 0 4px'>Nobody assigned — tag with @zach/@taylor/@both.</p>")
        parts.append(ul(untagged))
    parts.append("<p style='color:#888;font-size:13px'>— T/Z Task Manager</p></div>")
    return "".join(parts)


# --------------------------------------------------------------------------- #
# Sending
# --------------------------------------------------------------------------- #
def send_email(cfg: dict, to_email: str, subject: str, text_body: str, html_body: str):
    smtp = cfg["smtp"]
    msg = EmailMessage()
    msg["Subject"] = subject
    from_name = smtp.get("from_name", "T/Z Task Manager")
    from_email = smtp.get("from_email", smtp["user"])
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP_SSL(smtp["host"], smtp.get("port", 465), timeout=30) as server:
        server.login(smtp["user"], smtp["app_password"])
        server.send_message(msg)


def recipient_for(cfg: dict, person: str) -> str:
    """Real address, unless test_mode redirects this person."""
    if cfg.get("test_mode") and person in cfg.get("test_redirect", {}):
        return cfg["test_redirect"][person]
    return cfg["people"][person]["email"]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(
            f"ERROR: no config file at {path}\n"
            "Copy config.example.json to config.json and fill in your Gmail app password."
        )
    return json.loads(path.read_text())


def main(argv=None):
    ap = argparse.ArgumentParser(description="Send daily T/Z task reminder emails.")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    ap.add_argument("--dry-run", action="store_true", help="Print emails, send nothing.")
    ap.add_argument("--day", help="Override weekday (e.g. Tuesday). Defaults to today.")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    note_title = cfg.get("note_title", "T/Z Task Manager")

    if args.day:
        weekday = args.day.strip().lower()
        if weekday not in WEEKDAYS:
            raise SystemExit(f"ERROR: --day must be one of {', '.join(WEEKDAYS)}")
    else:
        weekday = WEEKDAYS[dt.date.today().weekday()]
    weekday_label = weekday.capitalize()

    body = read_note_body(note_title)
    days = parse_note(html_to_lines(body))
    bucket = days[weekday]

    people = {"zach": cfg["people"]["zach"]["name"], "taylor": cfg["people"]["taylor"]["name"]}
    pairs = [("zach", "taylor"), ("taylor", "zach")]

    test = cfg.get("test_mode")
    for person, partner in pairs:
        mine, partners, untagged = compose_for(person, partner, bucket)
        name, partner_name = people[person], people[partner]

        # Skip people with nothing today (own tasks or an untagged item to fix),
        # so blank/unfilled days don't send annoying "nothing to do" emails.
        if not mine and not untagged:
            print(f"No tasks for {name} on {weekday_label} — skipping.")
            continue

        subject = f"{'[TEST] ' if test else ''}Your {weekday_label} tasks"
        text_body = render_plain(name, partner_name, weekday_label, mine, partners, untagged)
        html_body = render_html(name, partner_name, weekday_label, mine, partners, untagged)
        to_email = recipient_for(cfg, person)

        if args.dry_run:
            print("=" * 60)
            print(f"TO: {to_email}    SUBJECT: {subject}")
            print("-" * 60)
            print(text_body)
            print()
        else:
            send_email(cfg, to_email, subject, text_body, html_body)
            print(f"Sent {weekday_label} reminder to {name} <{to_email}>")

    return 0


if __name__ == "__main__":
    sys.exit(main())
