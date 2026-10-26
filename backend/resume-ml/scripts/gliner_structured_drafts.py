"""Turn the already-generated local GLiNER span suggestions into structured review drafts."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from structured_pipeline import empty_extraction, normalize_extraction, text_hash


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "training_sample" / "gliner_suggestions.jsonl"
DEFAULT_MANIFEST = ROOT / "data" / "training_sample" / "raw" / "manifest.csv"
DEFAULT_OUTPUT = ROOT / "data" / "structured" / "drafts.jsonl"
LABELS = {"PERSON", "EMAIL", "PHONE", "URL", "SKILL", "DEGREE", "SCHOOL", "COMPANY", "JOB_TITLE", "DATE"}


def load_manifest(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        raise SystemExit(f"Manifest not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as source:
        return {row["text_sha256"]: row for row in csv.DictReader(source) if row.get("text_sha256")}


def unique_texts(entities: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    values = []
    for entity in entities:
        if entity["label"] != label:
            continue
        key = " ".join(entity["text"].casefold().split())
        if key and key not in seen:
            seen.add(key)
            values.append(entity)
    return values


def entity_records(text: str, spans: list[Any]) -> list[dict[str, Any]]:
    entities = []
    for span in spans:
        if not isinstance(span, (list, tuple)) or len(span) != 3:
            continue
        start, end, label = span
        if not isinstance(start, int) or not isinstance(end, int) or label not in LABELS or not (0 <= start < end <= len(text)):
            continue
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", end)
        if line_end < 0:
            line_end = len(text)
        entities.append({
            "start": start,
            "end": end,
            "label": label,
            "text": text[start:end],
            "context": text[line_start:line_end].strip(),
        })
    return sorted(entities, key=lambda item: (item["start"], item["end"], item["label"]))


def make_extraction(text: str, entities: list[dict[str, Any]]) -> dict[str, Any]:
    # GLiNER suggestions have not been validated against this resume collection.
    # Keep structured fields empty until a person confirms them in the review UI;
    # candidate spans remain available as navigation aids.
    return normalize_extraction(empty_extraction())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, help="Create drafts for the first N input rows")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if not args.input.is_file():
        raise SystemExit(f"GLiNER suggestions not found: {args.input}")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be at least 1")
    if args.output.exists() and not args.overwrite:
        raise SystemExit(f"Output already exists; choose another path or pass --overwrite: {args.output}")
    manifest = load_manifest(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    processed = 0
    with args.input.open(encoding="utf-8-sig") as source, args.output.open("w", encoding="utf-8", newline="\n") as target:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            metadata = manifest.get(text_hash(text))
            if metadata is None:
                raise SystemExit(f"Suggestion text does not match the manifest on line {line_number}")
            entities = entity_records(text, item.get("labels", []))
            draft = {
                "resume_id": metadata["resume_id"],
                "category": metadata.get("category", "Uncategorized"),
                "text": text,
                "extraction": make_extraction(text, entities),
                "candidate_entities": entities,
                "reviewed": False,
                "draft_status": "partial",
                "draft_model": "GLiNER candidates only; all fields require human verification",
            }
            target.write(json.dumps(draft, ensure_ascii=False) + "\n")
            processed += 1
            if args.limit is not None and processed >= args.limit:
                break
            if processed % 25 == 0:
                print(json.dumps({"drafted": processed}), flush=True)
    print(json.dumps({"drafted": processed, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
