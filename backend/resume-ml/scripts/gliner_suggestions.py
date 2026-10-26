"""Create local, editable Doccano entity suggestions with pretrained GLiNER."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from gliner import GLiNER


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "pilot" / "raw" / "doccano_import.jsonl"
DEFAULT_OUTPUT = ROOT / "data" / "pilot" / "gliner_suggestions.jsonl"
MODEL_NAME = "gliner-community/gliner_small-v2.5"
LABELS = {
    "person name": "PERSON",
    "email address": "EMAIL",
    "phone number": "PHONE",
    "website or profile url": "URL",
    "technical skill": "SKILL",
    "degree or qualification": "DEGREE",
    "school or university": "SCHOOL",
    "company or employer": "COMPANY",
    "job title": "JOB_TITLE",
    "date or date range": "DATE",
}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>]+", re.IGNORECASE)


def chunks(text: str, max_chars: int, overlap: int):
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            boundary = text.rfind("\n", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        yield start, end, text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - overlap)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=MODEL_NAME)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--chunk-chars", type=int, default=1400)
    parser.add_argument("--overlap-chars", type=int, default=120)
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input JSONL not found: {args.input}")
    if args.chunk_chars < 300 or not 0 <= args.overlap_chars < args.chunk_chars:
        raise SystemExit("Use chunk size >= 300 and overlap smaller than chunk size")

    model = GLiNER.from_pretrained(args.model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    processed = 0
    with args.input.open(encoding="utf-8") as source, args.output.open(
        "w", encoding="utf-8", newline="\n"
    ) as target:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text", "")
            candidates: list[tuple[int, int, str, float]] = []
            for offset, _, chunk_text in chunks(text, args.chunk_chars, args.overlap_chars):
                for entity in model.predict_entities(
                    chunk_text, list(LABELS), threshold=args.threshold
                ):
                    label = LABELS.get(str(entity.get("label", "")).casefold())
                    start = int(entity["start"]) + offset
                    end = int(entity["end"]) + offset
                    if label and 0 <= start < end <= len(text):
                        candidates.append((start, end, label, float(entity.get("score", 0.0))))

            for pattern, label in ((EMAIL_RE, "EMAIL"), (PHONE_RE, "PHONE"), (URL_RE, "URL")):
                candidates.extend((match.start(), match.end(), label, 1.0) for match in pattern.finditer(text))

            # Doccano's span format and spaCy NER both require non-overlapping entities.
            accepted: list[tuple[int, int, str, float]] = []
            for candidate in sorted(candidates, key=lambda value: (-value[3], value[0], value[1])):
                if not any(candidate[0] < current[1] and current[0] < candidate[1] for current in accepted):
                    accepted.append(candidate)
            labels = [[start, end, label] for start, end, label, _ in sorted(accepted)]
            target.write(json.dumps({"text": text, "labels": labels}, ensure_ascii=False) + "\n")
            processed += 1
            if processed % 25 == 0:
                print(json.dumps({"suggested": processed, "source_line": line_number}), flush=True)

    print(json.dumps({"suggested": processed, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
