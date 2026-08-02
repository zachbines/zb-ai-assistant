#!/usr/bin/env python3
"""
Fetch Gmail emails matching label:HC with decoded body text, for task extraction.

Usage:
    python3 .claude/skills/hc-tasks/scripts/hc_tasks_fetch.py \
        --account ACCOUNT --limit 100 --output .tmp/hc_emails.json

Output: JSON array of {id, subject, from, date, body}.
"""

import os
import sys
import json
import base64
import argparse
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
]
ACCOUNTS_FILE = "gmail_accounts.json"
BODY_CHAR_LIMIT = 4000


def load_accounts() -> dict:
    if os.path.exists(ACCOUNTS_FILE):
        with open(ACCOUNTS_FILE, "r") as f:
            return json.load(f)
    return {}


def get_service(account: str):
    accounts = load_accounts()
    if account not in accounts:
        print(f"Error: Account '{account}' not found. Available: {list(accounts.keys())}", file=sys.stderr)
        sys.exit(1)

    token_file = accounts[account].get("token_file")
    if not token_file or not os.path.exists(token_file):
        print(f"Error: Token file '{token_file}' not found for {account}. Run gmail_multi_auth.py first.", file=sys.stderr)
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(token_file, "w") as f:
                f.write(creds.to_json())
        else:
            print(f"Error: Invalid credentials for {account}. Re-run gmail_multi_auth.py.", file=sys.stderr)
            sys.exit(1)

    return build("gmail", "v1", credentials=creds)


def extract_body(payload: dict) -> str:
    """Walk MIME parts and concatenate text/plain bodies; fall back to text/html stripped."""
    chunks_plain = []
    chunks_html = []

    def walk(part):
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        data = body.get("data")
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data.encode("ASCII")).decode("utf-8", errors="replace")
            except Exception:
                decoded = ""
            if mime == "text/plain":
                chunks_plain.append(decoded)
            elif mime == "text/html":
                chunks_html.append(decoded)
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)

    text = "\n".join(chunks_plain).strip()
    if not text and chunks_html:
        import re
        html = "\n".join(chunks_html)
        html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"\s+", " ", html).strip()
        text = html
    return text[:BODY_CHAR_LIMIT]


def fetch_hc_emails(service, limit: int) -> list[dict]:
    query = "label:HC"
    message_ids = []
    page_token = None

    while len(message_ids) < limit:
        remaining = limit - len(message_ids)
        try:
            results = service.users().messages().list(
                userId="me",
                q=query,
                pageToken=page_token,
                maxResults=min(500, remaining),
            ).execute()
            batch = results.get("messages", [])
            if batch:
                message_ids.extend([m["id"] for m in batch])
            page_token = results.get("nextPageToken")
            if not page_token:
                break
        except HttpError as e:
            print(f"Error searching: {e}", file=sys.stderr)
            break

    message_ids = message_ids[:limit]
    if not message_ids:
        return []

    messages = {}

    def callback(request_id, response, exception):
        if exception:
            messages[request_id] = {
                "id": request_id,
                "subject": "(error)",
                "from": "",
                "date": "",
                "body": "",
            }
            return
        headers = {h["name"]: h["value"] for h in response.get("payload", {}).get("headers", [])}
        messages[request_id] = {
            "id": response["id"],
            "subject": headers.get("Subject", "(no subject)"),
            "from": headers.get("From", "(unknown)"),
            "date": headers.get("Date", ""),
            "body": extract_body(response.get("payload", {})),
        }

    for i in range(0, len(message_ids), 50):
        batch = service.new_batch_http_request(callback=callback)
        for msg_id in message_ids[i:i + 50]:
            batch.add(
                service.users().messages().get(userId="me", id=msg_id, format="full"),
                request_id=msg_id,
            )
        batch.execute()

    return [messages[mid] for mid in message_ids if mid in messages]


def main():
    parser = argparse.ArgumentParser(description="Fetch HC-labeled Gmail emails with body for task extraction")
    parser.add_argument("--account", "-a", required=True)
    parser.add_argument("--limit", "-l", type=int, default=100)
    parser.add_argument("--output", "-o", required=True)
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    print(f"Connecting to Gmail API [{args.account}]...")
    service = get_service(args.account)

    print(f"Fetching label:HC emails (limit: {args.limit})")
    emails = fetch_hc_emails(service, args.limit)
    print(f"Fetched {len(emails)} emails")

    with open(args.output, "w") as f:
        json.dump(emails, f, indent=2)
    print(f"Written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
