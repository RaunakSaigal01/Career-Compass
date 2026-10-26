"""Score a fine-tuned GLiNER model on corrected held-out Doccano spans."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from gliner import GLiNER


PROMPTS = {
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
PROMPT_TO_LABEL = {value: key for key, value in PROMPTS.items()}


def text_chunks(text: str, max_chars: int = 1400, overlap: int = 120):
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            boundary = text.rfind("\n", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        yield start, text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - overlap)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("models/resume_gliner/model-best"))
    parser.add_argument("--test", type=Path, default=Path("data/gliner_prepared/test.json"))
    parser.add_argument("--threshold", type=float, default=0.45)
    args = parser.parse_args()
    if not args.model.exists() or not args.test.is_file():
        raise SystemExit("Model or held-out test file was not found; see --model and --test.")

    model = GLiNER.from_pretrained(str(args.model))
    examples = json.loads(args.test.read_text(encoding="utf-8"))
    true_positive: Counter[str] = Counter()
    predicted: Counter[str] = Counter()
    gold: Counter[str] = Counter()

    for row in examples:
        expected = {(int(start), int(end), label) for start, end, label in row["entities_char"]}
        actual = set()
        for offset, chunk in text_chunks(row["text"]):
            for entity in model.predict_entities(chunk, list(PROMPTS.values()), threshold=args.threshold):
                label = PROMPT_TO_LABEL.get(str(entity.get("label", "")).casefold())
                if label:
                    actual.add((int(entity["start"]) + offset, int(entity["end"]) + offset, label))
        for _, _, label in expected:
            gold[label] += 1
        for _, _, label in actual:
            predicted[label] += 1
        true_positive.update(expected & actual)

    report = {"documents": len(examples), "entities": {}}
    for label in sorted(set(gold) | set(predicted)):
        tp = true_positive[label]
        precision = tp / predicted[label] if predicted[label] else 0.0
        recall = tp / gold[label] if gold[label] else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        report["entities"][label] = {
            "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
            "correct": tp, "predicted": predicted[label], "gold": gold[label],
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
