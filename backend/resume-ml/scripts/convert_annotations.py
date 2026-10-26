"""Validate Doccano sequence labels, split by resume/category, and write spaCy DocBins."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import spacy
from spacy.tokens import DocBin


ROOT = Path(__file__).resolve().parents[1]


def text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().casefold()
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()


def load_manifest(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    return {row["text_sha256"]: row for row in rows if row.get("text_sha256")}


def split_by_category(rows: list[dict], seed: int) -> dict[str, list[dict]]:
    by_category: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)

    splits: dict[str, list[dict]] = {"train": [], "dev": [], "test": []}
    for category in sorted(by_category):
        samples = by_category[category]
        random.Random(f"{seed}:{category}").shuffle(samples)
        count = len(samples)
        if count == 1:
            assignments = (1, 0, 0)
        elif count == 2:
            assignments = (1, 0, 1)
        elif count == 3:
            assignments = (1, 1, 1)
        else:
            train_count = max(1, int(count * 0.70))
            dev_count = max(1, int(count * 0.15))
            if train_count + dev_count >= count:
                train_count = count - 2
                dev_count = 1
            assignments = (train_count, dev_count, count - train_count - dev_count)

        train_count, dev_count, _ = assignments
        splits["train"].extend(samples[:train_count])
        splits["dev"].extend(samples[train_count:train_count + dev_count])
        splits["test"].extend(samples[train_count + dev_count:])
    return splits


def to_docbin(rows: list[dict], nlp, output_path: Path) -> Counter:
    docbin = DocBin(store_user_data=True)
    label_counts: Counter = Counter()
    for row in rows:
        doc = nlp.make_doc(row["text"])
        spans = []
        for label in row["labels"]:
            if not isinstance(label, (list, tuple)) or len(label) != 3:
                raise ValueError(f"Invalid label record in resume {row['resume_id']}: {label!r}")
            start, end, entity_label = label
            span = doc.char_span(int(start), int(end), label=str(entity_label), alignment_mode="strict")
            if span is None:
                raise ValueError(
                    f"Label offsets do not align with tokens for resume {row['resume_id']}: {label!r}. "
                    "Check that annotation text exactly matches the extracted text."
                )
            spans.append(span)
            label_counts[str(entity_label)] += 1
        try:
            doc.ents = spans
        except ValueError as error:
            raise ValueError(
                f"Overlapping entity labels in resume {row['resume_id']}; spaCy NER requires non-overlapping spans."
            ) from error
        doc.user_data["resume_id"] = row["resume_id"]
        doc.user_data["category"] = row["category"]
        docbin.add(doc)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    docbin.to_disk(output_path)
    return label_counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, required=True, help="Doccano sequence-labeling JSONL export")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "raw" / "manifest.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "prepared")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    rows: list[dict] = []
    missing: list[str] = []
    with args.annotations.open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text", "")
            metadata = manifest.get(text_hash(text))
            if not metadata:
                missing.append(f"line {line_number}")
                continue
            labels = item.get("labels", [])
            rows.append({
                "text": text,
                "labels": labels,
                "resume_id": metadata["resume_id"],
                "category": metadata["category"],
            })

    if missing:
        sample = ", ".join(missing[:10])
        raise SystemExit(
            f"{len(missing)} annotated rows did not match the manifest ({sample}). "
            "Do not edit or normalize imported text after annotation."
        )
    if not rows:
        raise SystemExit("No annotated resumes found. Export Doccano sequence labels as JSONL first.")

    splits = split_by_category(rows, args.seed)
    nlp = spacy.blank("en")
    summary = {"documents": {}, "entities": {}, "seed": args.seed}
    for name, subset in splits.items():
        counts = to_docbin(subset, nlp, args.output / f"{name}.spacy")
        summary["documents"][name] = len(subset)
        summary["entities"][name] = dict(counts)

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
