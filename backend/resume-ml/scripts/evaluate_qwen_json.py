"""Evaluate structured Qwen extraction on a reviewed, held-out test split."""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from generate_structured_drafts import chunks_for_text, generate_one, merge_extractions
from structured_pipeline import empty_extraction, normalize_extraction


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEST = ROOT / "data" / "qwen_prepared" / "test.jsonl"
DEFAULT_ADAPTER = ROOT / "models" / "qwen_resume_json" / "model-best"
DEFAULT_REPORT = ROOT / "data" / "reports" / "qwen_json_eval.json"


def read_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise SystemExit(f"Test file not found: {path}")
    with path.open(encoding="utf-8-sig") as source:
        rows = [json.loads(line) for line in source if line.strip()]
    if not rows:
        raise SystemExit(f"Test file is empty: {path}")
    return rows


def field_values(extraction: dict[str, Any]) -> dict[str, set[str]]:
    values: dict[str, set[str]] = {}

    def add(path: str, value: Any) -> None:
        if isinstance(value, str) and value.strip():
            values.setdefault(path, set()).add(" ".join(value.casefold().split()))

    for key in ("full_name", "email", "phone", "linkedin", "github", "summary"):
        add(key, extraction.get(key))
    for group in ("skills", "experience", "education", "projects", "certifications"):
        for item in extraction.get(group, []):
            add(group, item)
    return values


def normalized_full(extraction: dict[str, Any]) -> str:
    return json.dumps(extraction, ensure_ascii=False, sort_keys=True, separators=(",", ":")).casefold()


def score_counts(gold: Counter[str], predicted: Counter[str], true_positive: Counter[str]) -> dict[str, Any]:
    result = {}
    for field in sorted(set(gold) | set(predicted)):
        tp = true_positive[field]
        precision = tp / predicted[field] if predicted[field] else 0.0
        recall = tp / gold[field] if gold[field] else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        result[field] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "correct": tp,
            "predicted": predicted[field],
            "gold": gold[field],
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test", type=Path, default=DEFAULT_TEST)
    parser.add_argument("--adapter", type=Path, default=DEFAULT_ADAPTER)
    parser.add_argument("--base-model", default=None, help="Defaults to base_model in training.json")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--max-new-tokens", type=int, default=1800)
    parser.add_argument("--max-input-tokens", type=int, default=6000)
    parser.add_argument("--overlap-tokens", type=int, default=256)
    parser.add_argument("--limit", type=int, default=None, help="Limit number of test documents to evaluate")
    args = parser.parse_args()

    if not args.adapter.is_dir():
        raise SystemExit(f"Model adapter directory not found: {args.adapter}")
    metadata_path = args.adapter.parent / "training.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.is_file() else {}
    base_model = args.base_model or metadata.get("base_model") or "Qwen/Qwen3-0.6B"
    rows = read_rows(args.test)
    if args.limit and args.limit > 0:
        rows = rows[:args.limit]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForCausalLM.from_pretrained(base_model, dtype=dtype)
    model = PeftModel.from_pretrained(model, args.adapter)
    model.to(device)
    model.eval()

    gold_counts: Counter[str] = Counter()
    predicted_counts: Counter[str] = Counter()
    correct_counts: Counter[str] = Counter()
    exact_documents = 0
    parse_errors = 0
    durations = []
    for index, row in enumerate(rows, start=1):
        gold = normalize_extraction(row["target"])
        started = time.perf_counter()
        try:
            parts = [
                generate_one(model, tokenizer, device, excerpt, args.max_new_tokens)
                for excerpt in chunks_for_text(tokenizer, row["text"], args.max_input_tokens, args.overlap_tokens)
            ]
            prediction = merge_extractions(parts)
        except Exception:
            prediction = empty_extraction()
            parse_errors += 1
        if device.type == "cuda":
            torch.cuda.synchronize()
        durations.append(time.perf_counter() - started)
        if normalized_full(gold) == normalized_full(prediction):
            exact_documents += 1
        gold_values = field_values(gold)
        predicted_values = field_values(prediction)
        for field in set(gold_values) | set(predicted_values):
            expected = gold_values.get(field, set())
            actual = predicted_values.get(field, set())
            gold_counts[field] += len(expected)
            predicted_counts[field] += len(actual)
            correct_counts[field] += len(expected & actual)
        if index % 10 == 0:
            print(json.dumps({"evaluated": index, "total": len(rows), "parse_errors": parse_errors}), flush=True)

    report = {
        "documents": len(rows),
        "exact_record_match": round(exact_documents / len(rows), 4),
        "exact_record_matches": exact_documents,
        "parse_errors": parse_errors,
        "mean_inference_seconds": round(sum(durations) / len(durations), 4),
        "device": str(device),
        "base_model": base_model,
        "field_metrics": score_counts(gold_counts, predicted_counts, correct_counts),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({**report, "report": str(args.report)}, indent=2))


if __name__ == "__main__":
    main()
