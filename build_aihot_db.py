#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cache AI HOT public API data for the Qi Signalwise browser."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path


BASE = "https://aihot.virxact.com"
OUT_FILE = Path(__file__).resolve().parent / "qi-hot-db.js"
UA = "qi-signalwise-local-cache/1.0"


def fetch_json(path: str, params: dict[str, object] | None = None) -> dict[str, object]:
    query = urllib.parse.urlencode(params or {})
    url = f"{BASE}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def collect_items(mode: str, take: int = 100) -> list[dict[str, object]]:
    payload = fetch_json("/api/public/items", {"mode": mode, "take": take})
    return list(payload.get("items") or [])


def main() -> int:
    errors: list[str] = []
    selected: list[dict[str, object]] = []
    all_items: list[dict[str, object]] = []
    latest_daily: dict[str, object] | None = None
    dailies: list[dict[str, object]] = []

    for mode, target in [("selected", "selected"), ("all", "all")]:
        try:
            items = collect_items(mode)
            if target == "selected":
                selected = items
            else:
                all_items = items
            time.sleep(1.1)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            errors.append(f"{mode}: {exc}")

    try:
        latest_daily = fetch_json("/api/public/daily")
        time.sleep(1.1)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        errors.append(f"daily: {exc}")

    try:
        dailies_payload = fetch_json("/api/public/dailies", {"take": 30})
        dailies = list(dailies_payload.get("dailies") or dailies_payload.get("items") or [])
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        errors.append(f"dailies: {exc}")

    by_id: dict[str, dict[str, object]] = {}
    for item in all_items + selected:
        item_id = str(item.get("id") or item.get("permalink") or item.get("url") or "")
        if item_id:
            by_id[item_id] = item

    data = {
        "meta": {
            "source": BASE,
            "builtAt": datetime.now().isoformat(timespec="seconds"),
            "userAgent": UA,
            "errors": errors,
            "selectedCount": len(selected),
            "allCount": len(all_items),
            "mergedCount": len(by_id),
            "dailyDate": latest_daily.get("date") if isinstance(latest_daily, dict) else "",
        },
        "selected": selected,
        "items": sorted(
            by_id.values(),
            key=lambda item: str(item.get("publishedAt") or ""),
            reverse=True,
        ),
        "latestDaily": latest_daily or {},
        "dailies": dailies,
    }
    OUT_FILE.write_text(
        "window.QI_AIHOT_DB = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(
        f"Built {OUT_FILE}: {len(selected)} selected, {len(all_items)} all, "
        f"{len(by_id)} merged, {len(errors)} errors"
    )
    for error in errors:
        print(f"  {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
