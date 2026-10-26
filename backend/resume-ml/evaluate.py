"""Evaluate an extracted spaCy model against the held-out test DocBin."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import spacy
from spacy.tokens import DocBin


ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=ROOT / "models" / "resume_ner" / "model-best")
    parser.add_argument("--test", type=Path, default=ROOT / "data" / "prepared" / "test.spacy")
    args = parser.parse_args()

    if not args.model.exists():
        raise SystemExit(f"Trained model not found: {args.model}")
    if not args.test.exists():
        raise SystemExit(f"Test data not found: {args.test}")

    nlp = spacy.load(args.model)
    nlp.max_length = max(nlp.max_length, 150_000)
    docs = list(DocBin().from_disk(args.test).get_docs(nlp.vocab))
    true_positive: Counter[str] = Counter()
    predicted: Counter[str] = Counter()
    gold: Counter[str] = Counter()

    for gold_doc in docs:
        predicted_doc = nlp(gold_doc.text)
        expected = {(entity.start_char, entity.end_char, entity.label_) for entity in gold_doc.ents}
        actual = {(entity.start_char, entity.end_char, entity.label_) for entity in predicted_doc.ents}
        for _, _, label in expected:
            gold[label] += 1
        for _, _, label in actual:
            predicted[label] += 1
        true_positive.update(expected & actual)

    labels = sorted(set(gold) | set(predicted))
    report = {"documents": len(docs), "entities": {}}
    for label in labels:
        tp = true_positive[label]
        precision = tp / predicted[label] if predicted[label] else 0.0
        recall = tp / gold[label] if gold[label] else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        report["entities"][label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "correct": tp,
            "predicted": predicted[label],
            "gold": gold[label],
        }

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
