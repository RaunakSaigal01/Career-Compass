"""Validate reviewed structured extractions and create category-stratified splits."""

from __future__ import annotations

import argparse
import csv
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from structured_pipeline import normalize_extraction, text_hash


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANNOTATIONS = ROOT / "data" / "structured" / "reviewed.jsonl"
DEFAULT_MANIFEST = ROOT / "data" / "training_sample" / "raw" / "manifest.csv"
DEFAULT_OUTPUT = ROOT / "data" / "qwen_prepared"


def load_manifest(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        raise SystemExit(f"Manifest not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        return {row["resume_id"]: row for row in rows if row.get("resume_id")}


def split_category(rows: list[dict[str, Any]], seed: int) -> dict[str, list[dict[str, Any]]]:
    categories: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        categories[row["category"]].append(row)

    result = {"train": [], "dev": [], "test": []}
    for category in sorted(categories):
        group = categories[category][:]
        random.Random(f"{seed}:{category}").shuffle(group)
        size = len(group)
        if size == 1:
            counts = (1, 0, 0)
        elif size == 2:
            counts = (1, 0, 1)
        elif size == 3:
            counts = (1, 1, 1)
        else:
            train_n = max(1, int(size * 0.70))
            dev_n = max(1, int(size * 0.15))
            if train_n + dev_n >= size:
                train_n, dev_n = size - 2, 1
            counts = (train_n, dev_n, size - train_n - dev_n)
        train_n, dev_n, test_n = counts
        result["train"].extend(group[:train_n])
        result["dev"].extend(group[train_n:train_n + dev_n])
        result["test"].extend(group[train_n + dev_n:train_n + dev_n + test_n])
    return result


def field_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for row in rows:
        extraction = row["target"]
        for field in ("full_name", "email", "phone", "linkedin", "github", "summary"):
            if extraction[field]:
                counts[field] += 1
        for field in ("skills", "experience", "education", "projects", "certifications"):
            counts[field] += len(extraction[field])
    return dict(sorted(counts.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, default=DEFAULT_ANNOTATIONS)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if not args.annotations.is_file():
        raise SystemExit(f"Reviewed annotation file not found: {args.annotations}")
    if args.output.exists() and any(args.output.iterdir()) and not args.overwrite:
        raise SystemExit(f"Output directory is not empty; choose another path or pass --overwrite: {args.output}")
    manifest = load_manifest(args.manifest)
    rows = []
    seen_ids: set[str] = set()
    with args.annotations.open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            resume_id = item.get("resume_id")
            if not resume_id:
                raise SystemExit(f"Missing resume_id on annotation line {line_number}")
            if resume_id in seen_ids:
                raise SystemExit(f"Duplicate resume_id on annotation line {line_number}: {resume_id}")
            seen_ids.add(resume_id)
            metadata = manifest.get(resume_id)
            if metadata is None:
                raise SystemExit(f"Unknown resume_id on annotation line {line_number}: {resume_id}")
            if item.get("reviewed") is not True:
                raise SystemExit(f"Resume {resume_id} is not marked reviewed; review every row before training")
            text = item.get("text")
            if not isinstance(text, str) or text_hash(text) != metadata.get("text_sha256"):
                raise SystemExit(f"Resume text does not match the manifest on line {line_number}: {resume_id}")
            try:
                target = normalize_extraction(item.get("extraction"))
            except ValueError as error:
                raise SystemExit(f"Invalid extraction for {resume_id}: {error}") from error
            rows.append({
                "resume_id": resume_id,
                "category": metadata.get("category", "Uncategorized"),
                "text": text,
                "target": target,
            })

    if len(rows) < 20:
        raise SystemExit(f"Only {len(rows)} reviewed resumes; review at least 20 before training a pilot model")
    splits = split_category(rows, args.seed)
    if any(not splits[name] for name in ("train", "dev", "test")):
        raise SystemExit("Need non-empty train, dev, and test splits; review more resumes from varied categories")

    args.output.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {"seed": args.seed, "documents": {}, "field_counts": {}, "category_counts": {}}
    for name, subset in splits.items():
        path = args.output / f"{name}.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as target_file:
            for row in subset:
                target_file.write(json.dumps(row, ensure_ascii=False) + "\n")
        summary["documents"][name] = len(subset)
        summary["field_counts"][name] = field_counts(subset)
        category_counts = Counter(row["category"] for row in subset)
        summary["category_counts"][name] = dict(sorted(category_counts.items()))
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({
        "documents": summary["documents"],
        "field_counts": summary["field_counts"],
        "seed": args.seed,
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
