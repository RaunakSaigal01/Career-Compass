"""Run the trained Qwen resume extractor on one PDF and save structured JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pymupdf
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from generate_structured_drafts import chunks_for_text, generate_one, merge_extractions


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ADAPTER = ROOT / "models" / "qwen_resume_json_v4" / "model-best"


def extract_pdf_text(path: Path, use_ocr: bool, dpi: int) -> tuple[str, int, bool]:
    page_texts: list[str] = []
    ocr_used = False
    ocr_engine = None
    with pymupdf.open(path) as document:
        page_count = len(document)
        for page in document:
            text = page.get_text("text").strip()
            if use_ocr and len(text) < 80:
                if ocr_engine is None:
                    from PIL import Image
                    from rapidocr import RapidOCR

                    ocr_engine = (RapidOCR(), Image)
                engine, image_module = ocr_engine
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72), alpha=False)
                image = image_module.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                result = engine(image, use_cls=False)
                recognized = result.txts or []
                if recognized:
                    text = "\n".join(recognized)
                ocr_used = True
            page_texts.append(text)
    return "\n".join(page_texts).replace("\x00", "").strip(), page_count, ocr_used


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path, help="Path to the resume PDF")
    parser.add_argument("--adapter", type=Path, default=DEFAULT_ADAPTER)
    parser.add_argument("--base-model", default=None, help="Defaults to base_model in training.json")
    parser.add_argument("--output", type=Path, default=None, help="Output JSON path")
    parser.add_argument("--ocr", action="store_true", help="OCR pages with little or no embedded text")
    parser.add_argument("--ocr-dpi", type=int, default=200)
    parser.add_argument("--max-input-tokens", type=int, default=6000)
    parser.add_argument("--overlap-tokens", type=int, default=256)
    parser.add_argument("--max-new-tokens", type=int, default=1800)
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")
    if not args.adapter.is_dir():
        raise SystemExit(f"Model adapter not found: {args.adapter}")
    if args.ocr_dpi < 72 or args.max_input_tokens < 256 or not 0 <= args.overlap_tokens < args.max_input_tokens:
        raise SystemExit("Use OCR DPI >= 72, max input tokens >= 256, and overlap smaller than max input tokens")

    training_metadata_path = args.adapter.parent / "training.json"
    training_metadata = json.loads(training_metadata_path.read_text(encoding="utf-8")) if training_metadata_path.is_file() else {}
    base_model = args.base_model or training_metadata.get("base_model") or "Qwen/Qwen3-0.6B"
    text, page_count, ocr_used = extract_pdf_text(args.pdf, args.ocr, args.ocr_dpi)
    if len(text) < 40:
        hint = " Try again with --ocr for a scanned/image-only PDF." if not args.ocr else " OCR returned too little text; check PDF image quality."
        raise SystemExit(f"Could not extract enough text from the PDF.{hint}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    print(json.dumps({"base_model": base_model, "adapter": str(args.adapter), "device": str(device), "text_characters": len(text)}), flush=True)
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForCausalLM.from_pretrained(base_model, dtype=dtype)
    model = PeftModel.from_pretrained(model, args.adapter)
    model.to(device)
    model.eval()

    excerpts = chunks_for_text(tokenizer, text, args.max_input_tokens, args.overlap_tokens)
    parts = [generate_one(model, tokenizer, device, excerpt, args.max_new_tokens) for excerpt in excerpts]
    result = {
        "source_pdf": args.pdf.name,
        "model": base_model,
        "adapter": str(args.adapter),
        "device": str(device),
        "pages": page_count,
        "text_characters": len(text),
        "ocr_used": ocr_used,
        "chunks": len(parts),
        "extraction": merge_extractions(parts),
    }
    output = args.output or args.pdf.with_suffix(".extracted.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "pages": page_count, "ocr_used": ocr_used, "chunks": len(parts)}, indent=2))


if __name__ == "__main__":
    main()
