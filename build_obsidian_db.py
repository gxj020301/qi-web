#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the browser database from the Qi Obsidian vault."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path


VAULT_ROOT = Path("/Users/qilu/Documents/Obsidian Vault/02-Areas/Qi信号跟踪")
OUT_FILE = Path(__file__).resolve().parent / "qi-db.js"


def clean(text: str, limit: int | None = None) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if limit and len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def strip_markdown(text: str, limit: int = 220) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[#>*_`\-]+", " ", text)
    return clean(text, limit)


def first_heading(text: str, fallback: str) -> str:
    match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    return clean(match.group(1), 120) if match else fallback


def doc_kind(path: Path, rel: str) -> str:
    name = path.name
    if "A-按主题分类" in rel and name == "主题深度报告.md":
        return "topic_report"
    if "A-按主题分类" in rel:
        return "topic_file"
    if "1-按日" in rel and name in {"解读报告.md", "分析报告.md"}:
        return "daily_report"
    if "1-按日" in rel:
        return "daily"
    if "2-按周" in rel and name == "解读报告.md":
        return "weekly_report"
    if "2-按周" in rel:
        return "weekly"
    if "3-按月" in rel and name == "解读报告.md":
        return "monthly_report"
    if "3-按月" in rel:
        return "monthly"
    if "C-Qi信号跟踪组" in rel:
        return "group"
    return "other"


def period_from_rel(rel: str) -> str:
    date_match = re.search(r"(20\d{2}-\d{2}-\d{2})", rel)
    if date_match:
        return date_match.group(1)
    week_match = re.search(r"(20\d{2}-W\d{2}|20\d{2}-\d{2}-\d{2}~20\d{2}-\d{2}-\d{2}|第\d+周\([^)]*\))", rel)
    if week_match:
        return week_match.group(1)
    month_match = re.search(r"(20\d{2}-\d{2}|\d+月)", rel)
    return month_match.group(1) if month_match else ""


def count_from_text(text: str) -> int | None:
    patterns = [
        r"共\s*(\d+)\s*条信号",
        r"信号总数[:：]\s*(\d+)\s*条?",
        r"数据统计[:：].*?共\s*(\d+)\s*条信号",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


def extract_topic(rel: str) -> str:
    parts = rel.split("/")
    if "A-按主题分类" in parts:
        idx = parts.index("A-按主题分类")
        if len(parts) > idx + 2:
            return parts[idx + 2]
    return ""


def theme_parts(rel: str) -> tuple[str, str]:
    parts = rel.split("/")
    if "A-按主题分类" not in parts:
        return "", ""
    idx = parts.index("A-按主题分类")
    major = parts[idx + 1] if len(parts) > idx + 1 else ""
    minor = parts[idx + 2] if len(parts) > idx + 2 else ""
    return major, minor


def time_bucket(kind: str) -> str:
    if kind in {"daily", "daily_report"}:
        return "daily"
    if kind in {"weekly", "weekly_report"}:
        return "weekly"
    if kind in {"monthly", "monthly_report"}:
        return "monthly"
    return ""


def line_value(block: str, labels: list[str]) -> str:
    label_re = "|".join(re.escape(label) for label in labels)
    for line in block.splitlines():
        match = re.match(rf"^\s*(?:[-*]\s*)?(?:\*\*)?(?:{label_re})\s*[:：]\s*(?:\*\*)?\s*(.+?)\s*$", line)
        if match:
            return match.group(1).strip().strip("*").strip()
    return ""


def extract_signals(text: str, doc: dict[str, object]) -> list[dict[str, object]]:
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if re.match(r"^#{2,6}\s+(.+)", line)]
    signals: list[dict[str, object]] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(lines)
        block = "\n".join(lines[start:end]).strip()
        if "twitter.com/" not in block and "x.com/" not in block:
            continue
        heading = re.match(r"^#{2,6}\s+(.+)", lines[start])
        if not heading:
            continue
        link_match = re.search(r"https?://(?:twitter|x)\.com/[^\s)）>]+", block)
        if not link_match:
            continue
        title = re.sub(r"^\d+\.\s*", "", heading.group(1)).strip()
        tags = sorted(set(re.findall(r"#[^\s#，,。；;、]+", block)))
        signals.append(
            {
                "id": f"{doc['id']}::s{len(signals) + 1}",
                "docId": doc["id"],
                "title": clean(title, 180),
                "link": link_match.group(0).rstrip("。),，；;"),
                "author": clean(line_value(block, ["推特作者", "账号", "作者"]), 120),
                "period": doc.get("period", ""),
                "topic": doc.get("topic", ""),
                "themeMajor": doc.get("themeMajor", ""),
                "themeMinor": doc.get("themeMinor", ""),
                "timeBucket": doc.get("timeBucket", ""),
                "sourceType": doc.get("kind", ""),
                "tags": tags[:12],
                "excerpt": strip_markdown(block, 320),
            }
        )
    return signals


def main() -> int:
    docs: list[dict[str, object]] = []
    signals: list[dict[str, object]] = []
    tag_counter: Counter[str] = Counter()
    kind_counter: Counter[str] = Counter()

    for idx, path in enumerate(sorted(VAULT_ROOT.rglob("*.md")), 1):
        rel = path.relative_to(VAULT_ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="ignore")
        kind = doc_kind(path, rel)
        theme_major, theme_minor = theme_parts(rel)
        doc = {
            "id": f"d{idx}",
            "title": first_heading(text, path.stem),
            "path": str(path),
            "rel": rel,
            "kind": kind,
            "period": period_from_rel(rel),
            "topic": extract_topic(rel),
            "themeMajor": theme_major,
            "themeMinor": theme_minor,
            "timeBucket": time_bucket(kind),
            "count": count_from_text(text),
            "excerpt": strip_markdown(text, 280),
            "content": text,
            "updatedAt": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
        }
        docs.append(doc)
        kind_counter[kind] += 1
        doc_signals = extract_signals(text, doc)
        signals.extend(doc_signals)
        for signal in doc_signals:
            tag_counter.update(signal["tags"])

    latest = max((doc["updatedAt"] for doc in docs), default="")
    data = {
        "meta": {
            "source": str(VAULT_ROOT),
            "builtAt": datetime.now().isoformat(timespec="seconds"),
            "latestUpdate": latest,
            "docCount": len(docs),
            "signalCount": len(signals),
            "kindCounts": dict(kind_counter),
            "topTags": tag_counter.most_common(40),
        },
        "docs": docs,
        "signals": signals,
    }
    OUT_FILE.write_text(
        "window.QI_OBSIDIAN_DB = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"Built {OUT_FILE}: {len(docs)} docs, {len(signals)} signals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
