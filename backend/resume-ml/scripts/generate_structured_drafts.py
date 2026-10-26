"""Generate local, editable structured-JSON drafts from OCR resume text."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from structured_pipeline import (
    SYSTEM_PROMPT,
    build_user_prompt,
    empty_extraction,
    normalize_extraction,
    parse_json_object,
    text_hash,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "training_sample" / "raw" / "doccano_import.jsonl"
DEFAULT_MANIFEST = ROOT / "data" / "training_sample" / "raw" / "manifest.csv"
DEFAULT_OUTPUT = ROOT / "data" / "structured" / "drafts.jsonl"
DEFAULT_MODEL = "Qwen/Qwen3-0.6B"


def load_manifest(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        raise SystemExit(f"Manifest not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        result = {row["text_sha256"]: row for row in rows if row.get("text_sha256")}
    if not result:
        raise SystemExit(f"Manifest has no usable rows: {path}")
    return result


def chunks_for_text(tokenizer, text: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    token_ids = tokenizer.encode(text, add_special_tokens=False)
    if not token_ids:
        return [""]
    chunks: list[str] = []
    step = max_tokens - overlap_tokens
    for start in range(0, len(token_ids), step):
        end = min(len(token_ids), start + max_tokens)
        chunk = tokenizer.decode(token_ids[start:end], skip_special_tokens=True)
        if chunk.strip():
            chunks.append(chunk)
        if end == len(token_ids):
            break
    return chunks


def merge_extractions(parts: list[dict[str, Any]]) -> dict[str, Any]:
    merged = empty_extraction()
    for key in ("full_name", "email", "phone", "linkedin", "github", "summary"):
        merged[key] = next((part[key] for part in parts if part.get(key)), None)

    for key in ("skills", "experience", "education", "projects", "certifications"):
        seen: set[str] = set()
        for part in parts:
            for value in part.get(key, []):
                signature = " ".join(value.casefold().split())
                if signature not in seen:
                    seen.add(signature)
                    merged[key].append(value)
    return normalize_extraction(merged)


def generate_one(model, tokenizer, device: torch.device, text: str, max_new_tokens: int) -> dict[str, Any]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(text)},
    ]
    try:
        input_ids = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
            return_tensors="pt",
        )
    except TypeError:
        input_ids = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        )
    # Recent Transformers releases may return a BatchEncoding here instead of
    # a bare tensor, even when return_tensors="pt" is requested.
    if not isinstance(input_ids, torch.Tensor):
        input_ids = input_ids["input_ids"]
    input_ids = input_ids.to(device)
    attention_mask = torch.ones_like(input_ids)
    with torch.inference_mode():
        generated = model.generate(
            input_ids=input_ids,
            attention_mask=attention_mask,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            use_cache=True,
            pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    response = tokenizer.decode(generated[0, input_ids.shape[1]:], skip_special_tokens=True)
    return normalize_extraction(parse_json_object(response))


def load_completed(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    completed: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            resume_id = item.get("resume_id")
            if not resume_id:
                raise SystemExit(f"Existing draft has no resume_id on line {line_number}: {path}")
            completed[resume_id] = item
    return completed


def compact_successful_drafts(path: Path, rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Keep one successful row per resume so failed retries never duplicate IDs."""
    successful = {resume_id: row for resume_id, row in rows.items() if row.get("draft_status") == "ok"}
    if path.is_file():
        with path.open("w", encoding="utf-8", newline="\n") as target:
            for row in successful.values():
                target.write(json.dumps(row, ensure_ascii=False) + "\n")
    return successful


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-input-tokens", type=int, default=6000,
                        help="Maximum tokens per excerpt; long resumes are processed in overlapping excerpts")
    parser.add_argument("--overlap-tokens", type=int, default=256)
    parser.add_argument("--max-new-tokens", type=int, default=1800)
    parser.add_argument("--limit", type=int, help="Generate at most this many new drafts in this run")
    parser.add_argument("--overwrite", action="store_true", help="Replace the output file and regenerate all drafts")
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input JSONL not found: {args.input}")
    if args.max_input_tokens < 256 or not 0 <= args.overlap_tokens < args.max_input_tokens:
        raise SystemExit("Set --max-input-tokens >= 256 and overlap smaller than the input limit")
    if args.max_new_tokens < 100:
        raise SystemExit("--max-new-tokens must be at least 100")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    manifest = load_manifest(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.overwrite:
        args.output.unlink(missing_ok=True)
    existing = load_completed(args.output)
    if not args.overwrite:
        existing = compact_successful_drafts(args.output, existing)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    print(json.dumps({"model": args.model, "device": str(device), "existing_drafts": len(existing)}), flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype)
    model.to(device)
    model.eval()

    processed = 0
    with args.input.open(encoding="utf-8-sig") as source, args.output.open("a", encoding="utf-8", newline="\n") as target:
        for line_number, line in enumerate(source, start=1):
            if args.limit is not None and processed >= args.limit:
                break
            if not line.strip():
                continue
            item = json.loads(line)
            text = item.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            metadata = manifest.get(text_hash(text))
            if metadata is None:
                raise SystemExit(f"Resume text on input line {line_number} does not match the manifest")
            resume_id = metadata["resume_id"]
            previous = existing.get(resume_id)
            if previous and previous.get("draft_status") == "ok":
                continue

            row: dict[str, Any] = {
                "resume_id": resume_id,
                "category": metadata.get("category", "Uncategorized"),
                "text": text,
                "extraction": empty_extraction(),
                "reviewed": False,
                "draft_status": "ok",
                "draft_model": args.model,
            }
            try:
                parts = [
                    generate_one(model, tokenizer, device, excerpt, args.max_new_tokens)
                    for excerpt in chunks_for_text(tokenizer, text, args.max_input_tokens, args.overlap_tokens)
                ]
                row["extraction"] = merge_extractions(parts)
                row["chunks"] = len(parts)
            except Exception as error:
                row["draft_status"] = "needs_regeneration"
                row["draft_error"] = type(error).__name__
                print(json.dumps({"resume_id": resume_id, "draft_status": row["draft_status"], "error": type(error).__name__}), flush=True)
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
            target.flush()
            existing[resume_id] = row
            processed += 1
            if processed % 10 == 0:
                print(json.dumps({"drafted_this_run": processed, "source_line": line_number}), flush=True)

    print(json.dumps({"drafted_this_run": processed, "total_drafts": len(existing), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
