#!/usr/bin/env python3
"""Public, zero-spend fallback scanner for genuinely funded GitHub bounties.

A fresh redacted peer-state lease suppresses duplicate discovery. When that lease is
older than 30 minutes the scanner independently checks public GitHub issues and maintains
one rolling issue. It never claims work, submits PRs, spends money, or reads private chat.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

API = "https://api.github.com"
TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = os.environ.get("GITHUB_REPOSITORY", "evanbrown3000/startup-credits")
HERE = Path(__file__).resolve().parent
PEER_STATE = HERE / "peer_state.json"
PEER_MAX_AGE_MIN = 30
REPORT_TITLE = "LIVE: funded bounty screener"

SEARCHES = [
    'is:issue is:open label:"💎 Bounty" -repo:UnsafeLabs/Bounty-Hunters',
    'is:issue is:open "Opire" "/reward" -repo:UnsafeLabs/Bounty-Hunters',
    'is:issue is:open "BountyHub" -repo:UnsafeLabs/Bounty-Hunters',
    'is:issue is:open "paid on merge" bounty -repo:UnsafeLabs/Bounty-Hunters',
]
EXFIL = re.compile(
    r"runtime[_ -]?instructions|system prompt|pre[_ -]?task[_ -]?context|"
    r"environment[_ -]?config|initialization payload|beginning of your session|"
    r"paste verbatim.*conversation|full.*session.*instructions",
    re.I | re.S,
)
SECURITY = re.compile(
    r"exploit|rce|remote code execution|credential|password|token theft|malware|"
    r"phishing|bypass authentication|privilege escalation|zero[- ]day|0day|"
    r"weaponize|stealer|keylogger|botnet|ddos",
    re.I,
)
NO_SPEND = re.compile(r"entry fee|claim bond|deposit required|stake .* to claim|pay to submit", re.I)
ABANDONED = re.compile(r"not maintaining|no longer maintain|archived|bounty canc?elled", re.I)
ALREADY_DONE = re.compile(r"has been awarded|bounty.*awarded|rewarded to|already (?:solved|claimed)|solution.*merged", re.I)
NEGATIVE_FUNDING = re.compile(r"does not have any reward|cannot create a reward|can't create a reward|reward.*not.*active|bounty.*not.*active", re.I)
POSITIVE_BOT = re.compile(
    r"(?:💎|bounty).*\$\s*([0-9][0-9,]*(?:\.\d+)?)|"
    r"\$\s*([0-9][0-9,]*(?:\.\d+)?)\s*(?:bounty|reward)",
    re.I,
)
KNOWN_BOTS = {"algora-pbc", "algora-pbc[bot]", "opirebot[bot]", "gitearn-hq[bot]", "bountyhub[bot]"}


def request(path: str, method: str = "GET", body=None):
    url = path if path.startswith("http") else API + path
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "cognilode-public-bounty-fallback/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=25) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def parse_ts(value: str | None):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def fresh_peer_state():
    try:
        state = json.loads(PEER_STATE.read_text(encoding="utf-8"))
        ts = parse_ts(state.get("source_created_at"))
        if not ts:
            return None
        age = (dt.datetime.now(dt.timezone.utc) - ts).total_seconds() / 60
        if age > PEER_MAX_AGE_MIN:
            return None
        state["age_min"] = round(age, 1)
        return state
    except Exception:
        return None


def upsert_report(body: str):
    owner, repo = REPO.split("/", 1)
    issues = request(f"/repos/{owner}/{repo}/issues?state=open&per_page=100")
    target = next((x for x in issues if x.get("title") == REPORT_TITLE and "pull_request" not in x), None)
    payload = {"title": REPORT_TITLE, "body": body}
    if target:
        updated = request(f"/repos/{owner}/{repo}/issues/{target['number']}", "PATCH", payload)
        return updated["html_url"]
    return request(f"/repos/{owner}/{repo}/issues", "POST", payload)["html_url"]


def delegated_report(peer):
    return "\n".join([
        "<!-- managed-by:cognilode-public-bounty-fallback -->",
        "# Funded bounty screener — rolling state",
        "",
        "**Mode: DELEGATED_TO_FRESH_PEER_RADAR**",
        "",
        f"Redacted peer snapshot age: `{peer['age_min']} min`.",
        f"- half_hour_candidates: `{peer.get('half_hour_candidates', 0)}`",
        f"- deadline_fit_longer_horizon: `{peer.get('deadline_fit_longer_horizon', 0)}`",
        f"- payout_latency_unknown: `{peer.get('payout_latency_unknown', 0)}`",
        f"- prompt_exfiltration_exclusions: `{peer.get('prompt_exfiltration_exclusions', 0)}`",
        f"- security_exclusions: `{peer.get('security_exclusions', 0)}`",
        "",
        "Independent discovery is intentionally skipped while this peer lease is <=30 minutes old. After expiry the public fallback scans automatically.",
        "Income remains $0 until external proceeds are actually credited and accessible; bounty face value or a PR is not income.",
    ])


def search(q: str):
    p = urllib.parse.urlencode({"q": q, "sort": "updated", "order": "desc", "per_page": 25})
    return request(f"/search/issues?{p}").get("items", [])


def comments(owner: str, repo: str, number: int):
    return request(f"/repos/{owner}/{repo}/issues/{number}/comments?per_page=100")


@dataclass
class Candidate:
    repo: str
    number: int
    title: str
    url: str
    amount_usd: float
    score: float
    funding: str
    payout: str
    reasons: list[str]


def inspect(item):
    m = re.match(r"https://github\.com/([^/]+)/([^/]+)/issues/(\d+)", item.get("html_url", ""))
    if not m:
        return None
    owner, repo, n = m.groups(); n = int(n)
    if owner.casefold() == "evanbrown3000":
        return None
    cs = comments(owner, repo, n)
    title = item.get("title") or ""
    body = item.get("body") or ""
    labels = " ".join(x.get("name", "") for x in item.get("labels", []))
    ctext = "\n".join(c.get("body") or "" for c in cs)
    text = "\n".join([title, body, labels, ctext])
    reasons = []
    if EXFIL.search(text): reasons.append("secret/session-exfiltration criterion")
    if SECURITY.search(text): reasons.append("security-sensitive task")
    if NO_SPEND.search(text): reasons.append("fee/bond/stake required")
    if ABANDONED.search(ctext): reasons.append("project/maintainer says abandoned")
    if ALREADY_DONE.search(ctext): reasons.append("possible prior winner/merged solution")

    amounts = []
    negative = False
    for c in cs:
        login = ((c.get("user") or {}).get("login") or "").lower()
        t = c.get("body") or ""
        if login in KNOWN_BOTS or login.endswith("[bot]"):
            if NEGATIVE_FUNDING.search(t): negative = True
            for mm in POSITIVE_BOT.finditer(t):
                raw = mm.group(1) or mm.group(2)
                if raw:
                    amounts.append(float(raw.replace(",", "")))
    amount = max(amounts or [0.0])
    funding = "CONFIRMED" if amounts and not negative else "UNCONFIRMED"
    if funding != "CONFIRMED": reasons.append("no positive platform-bot funding receipt")

    low = text.lower(); payout = "unknown"
    if "2-5 days" in low or "2–5 days" in low: payout = "2-5 days after approval"
    elif "1-7 business days" in low or "1–7 business days" in low: payout = "1-7 business days"
    score = amount - min(len(cs), 25) * 1.5
    if payout != "unknown": score -= 10
    if reasons: score -= 200
    return Candidate(f"{owner}/{repo}", n, title, item["html_url"], amount, round(score, 2), funding, payout, reasons)


def fallback_report(items):
    eligible = [x for x in items if x.funding == "CONFIRMED" and x.score > 0 and not x.reasons]
    rejected = [x for x in items if x not in eligible]
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out = [
        "<!-- managed-by:cognilode-public-bounty-fallback -->",
        "# Funded bounty screener — rolling state",
        "",
        "**Mode: INDEPENDENT_FALLBACK — peer lease stale/missing.**",
        f"Last scan: `{now}`",
        "",
        "## Execution candidates",
    ]
    if not eligible:
        out.append("No high-confidence zero-spend candidate passed this scan.")
    for c in eligible[:10]:
        out.append(f"- **${c.amount_usd:g} — [{c.repo}#{c.number}]({c.url})** — score `{c.score}`; payout `{c.payout}` — {c.title}")
    out += ["", "## Rejected / negative evidence"]
    for c in rejected[:15]:
        out.append(f"- [{c.repo}#{c.number}]({c.url}): {'; '.join(c.reasons) or f'score={c.score}'}")
    out += ["", "The scanner never claims/submits/spends. A fresh executor must recheck upstream state before work. Only externally credited accessible proceeds count as income."]
    return "\n".join(out)


def main():
    peer = fresh_peer_state()
    if peer:
        url = upsert_report(delegated_report(peer))
        print(json.dumps({"mode": "delegated", "report": url, "peer_age_min": peer["age_min"]}, sort_keys=True))
        return
    seen = {}
    for q in SEARCHES:
        try:
            for item in search(q): seen[item["html_url"]] = item
        except Exception as exc:
            print(f"search failed: {q}: {exc}")
    inspected = []
    for item in list(seen.values())[:60]:
        try:
            c = inspect(item)
            if c: inspected.append(c)
        except Exception as exc:
            print(f"inspect failed {item.get('html_url')}: {exc}")
    inspected.sort(key=lambda x: x.score, reverse=True)
    url = upsert_report(fallback_report(inspected))
    print(json.dumps({"mode": "fallback", "report": url, "scanned": len(inspected)}, sort_keys=True))


if __name__ == "__main__":
    main()
