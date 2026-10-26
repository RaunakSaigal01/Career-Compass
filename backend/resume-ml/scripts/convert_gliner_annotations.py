"""Validate corrected Doccano spans and split them for GLiNER fine-tuning."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from gliner.data_processing.tokenizer import WordsSplitter


ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    "PERSON": "person name",
    "EMAIL": "email address",
    "PHONE": "phone number",
    "URL": "website or profile url",
    "SKILL": "technical skill",
    "DEGREE": "degree or qualification",
    "SCHOOL": "school or university",
    "COMPANY": "company or employer",
    "JOB_TITLE": "job title",
    "DATE": "date or date range",
}


def text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().casefold()
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()


def load_manifest(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        return {
            row["text_sha256"]: row
            for row in csv.DictReader(source)
            if row.get("text_sha256") and row.get("status") == "ready"
        }


def make_splits(rows: list[dict], seed: int) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row["category"]].append(row)

    result = {"train": [], "dev": [], "test": []}
    for category, samples in sorted(grouped.items()):
        random.Random(f"{seed}:{category}").shuffle(samples)
        count = len(samples)
        if count == 1:
            sizes = (1, 0, 0)
        elif count == 2:
            sizes = (1, 0, 1)
        elif count == 3:
            sizes = (1, 1, 1)
        else:
            train_size = max(1, int(count * 0.70))
            dev_size = max(1, int(count * 0.15))
            if train_size + dev_size >= count:
                train_size, dev_size = count - 2, 1
            sizes = (train_size, dev_size, count - train_size - dev_size)

        cursor = 0
        for split, size in zip(("train", "dev", "test"), sizes):
            result[split].extend(samples[cursor:cursor + size])
            cursor += size
    return result


def convert_row(text: str, labels: list, metadata: dict[str, str], splitter: WordsSplitter) -> dict:
    token_offsets = list(splitter(text))
    tokens = [token for token, _, _ in token_offsets]
    ner = []
    char_entities = []
    occupied: list[tuple[int, int]] = []

    for item in labels:
        if not isinstance(item, (list, tuple)) or len(item) != 3:
            raise ValueError(f"Invalid Doccano span for resume {metadata['resume_id']}: {item!r}")
        start, end, label = int(item[0]), int(item[1]), str(item[2]).upper()
        if label not in LABELS:
            raise ValueError(f"Unknown label {label!r} for resume {metadata['resume_id']}")
        if not 0 <= start < end <= len(text):
            raise ValueError(f"Invalid character offsets for resume {metadata['resume_id']}: {item!r}")
        if any(start < other_end and other_start < end for other_start, other_end in occupied):
            raise ValueError(f"Overlapping spans in resume {metadata['resume_id']}")

        start_token = next((i for i, (_, left, right) in enumerate(token_offsets) if left == start and right > start), None)
        end_token = next((i for i, (_, left, right) in enumerate(token_offsets) if left < end and right == end), None)
        if start_token is None or end_token is None or start_token > end_token:
            raise ValueError(
                f"Span {item!r} for resume {metadata['resume_id']} does not align to GLiNER word boundaries. "
                "Correct the Doccano selection to include whole words/punctuation tokens."
            )
        ner.append([start_token, end_token, LABELS[label]])
        char_entities.append([start, end, label])
        occupied.append((start, end))

    return {
        "text": text,
        "tokenized_text": tokens,
        "ner": ner,
        "entities_char": char_entities,
        "resume_id": metadata["resume_id"],
        "category": metadata["category"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, required=True, help="Human-reviewed Doccano JSONL export")
    parser.add_argument("--manifest", type=Path, default=ROOT / "data" / "pilot" / "raw" / "manifest.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "gliner_prepared")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    splitter = WordsSplitter("whitespace")
    rows = []
    unmatched = []
    with args.annotations.open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text", "")
            metadata = manifest.get(text_hash(text))
            if not metadata:
                unmatched.append(line_number)
                continue
            rows.append(convert_row(text, item.get("labels", []), metadata, splitter))

    if unmatched:
        raise SystemExit(f"{len(unmatched)} annotation rows failed to match the manifest; first lines: {unmatched[:10]}")
    if not rows:
        raise SystemExit("No matching corrected annotations found.")

    splits = make_splits(rows, args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    summary = {"documents": {}, "entities": {}, "seed": args.seed, "labels": LABELS}
    for name, subset in splits.items():
        path = args.output / f"{name}.json"
        path.write_text(json.dumps(subset, ensure_ascii=False, indent=2), encoding="utf-8")
        summary["documents"][name] = len(subset)
        summary["entities"][name] = {
            label: sum(entity[2] == prompt for row in subset for entity in row["ner"])
            for label, prompt in LABELS.items()
        }
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
