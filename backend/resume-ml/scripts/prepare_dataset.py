"""Extract searchable text from the resume PDF corpus for manual annotation."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
from pathlib import Path

import pymupdf
from PIL import Image
from rapidocr import RapidOCR


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = BACKEND_DIR / "Resumes PDF"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "raw"


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def normalized_hash_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-text-chars", type=int, default=120)
    parser.add_argument("--ocr", action="store_true", help="OCR pages with little or no embedded text")
    parser.add_argument("--ocr-dpi", type=int, default=200, help="Page rendering resolution when using OCR")
    parser.add_argument("--sample-per-category", type=int, help="Process a deterministic sample from each immediate PDF folder")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for category sampling")
    parser.add_argument("--progress-every", type=int, default=100, help="Print progress every N PDFs")
    args = parser.parse_args()

    if not args.input.is_dir():
        raise SystemExit(f"PDF input folder does not exist: {args.input}")
    if args.sample_per_category is not None and args.sample_per_category < 1:
        raise SystemExit("--sample-per-category must be at least 1")
    if args.progress_every < 1:
        raise SystemExit("--progress-every must be at least 1")

    args.output.mkdir(parents=True, exist_ok=True)
    import_path = args.output / "doccano_import.jsonl"
    manifest_path = args.output / "manifest.csv"
    low_text_path = args.output / "needs_ocr.csv"

    seen_text_hashes: set[str] = set()
    ocr = RapidOCR() if args.ocr else None
    counts = {"pdfs": 0, "kept": 0, "duplicates": 0, "needs_ocr": 0, "errors": 0}

    pdf_paths = sorted(args.input.rglob("*.pdf"))
    if args.sample_per_category is not None:
        by_category: dict[str, list[Path]] = {}
        for path in pdf_paths:
            by_category.setdefault(path.parent.relative_to(args.input).as_posix(), []).append(path)
        selected = []
        for category, paths in sorted(by_category.items()):
            rng = random.Random(f"{args.seed}:{category}")
            selected.extend(rng.sample(paths, min(args.sample_per_category, len(paths))))
        pdf_paths = sorted(selected)
        print(json.dumps({"sampling": "per_category", "selected": len(pdf_paths), "categories": len(by_category), "seed": args.seed}), flush=True)

    with (
        import_path.open("w", encoding="utf-8", newline="\n") as import_file,
        manifest_path.open("w", encoding="utf-8", newline="") as manifest_file,
        low_text_path.open("w", encoding="utf-8", newline="") as low_text_file,
    ):
        manifest = csv.DictWriter(
            manifest_file,
            fieldnames=["resume_id", "text_sha256", "category", "relative_path", "pages", "characters", "ocr_used", "status"],
        )
        low_text = csv.DictWriter(
            low_text_file,
            fieldnames=["resume_id", "category", "relative_path", "pages", "characters", "status"],
        )
        manifest.writeheader()
        low_text.writeheader()

        for pdf_path in pdf_paths:
            counts["pdfs"] += 1
            relative_path = pdf_path.relative_to(args.input)
            resume_id = stable_hash(relative_path.as_posix())[:20]
            category = relative_path.parent.name or "Uncategorized"
            try:
                with pymupdf.open(pdf_path) as document:
                    page_texts = []
                    ocr_used = False
                    scale = args.ocr_dpi / 72
                    matrix = pymupdf.Matrix(scale, scale)
                    for page in document:
                        page_text = page.get_text("text").strip()
                        if ocr and len(page_text) < 80:
                            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                            image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                            result = ocr(image, use_cls=False)
                            recognized = result.txts or []
                            if recognized:
                                page_text = "\n".join(recognized)
                            ocr_used = True
                        page_texts.append(page_text)
                    text = "\n".join(page_texts)
                    page_count = len(document)
                text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").strip()
                text_hash = stable_hash(normalized_hash_text(text))
                status = "ready" if len(text) >= args.min_text_chars else "needs_ocr"

                row = {
                    "resume_id": resume_id,
                    "text_sha256": text_hash,
                    "category": category,
                    "relative_path": relative_path.as_posix(),
                    "pages": page_count,
                    "characters": len(text),
                    "ocr_used": ocr_used,
                    "status": status,
                }
                if status == "needs_ocr":
                    counts["needs_ocr"] += 1
                    low_text.writerow({
                        key: row[key]
                        for key in ("resume_id", "category", "relative_path", "pages", "characters", "status")
                    })
                    continue

                if text_hash in seen_text_hashes:
                    counts["duplicates"] += 1
                    continue

                seen_text_hashes.add(text_hash)
                # Doccano's sequence-labeling import format accepts one text object per line.
                import_file.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
                manifest.writerow(row)
                counts["kept"] += 1
            except Exception as error:  # Keep the corpus run going when one PDF is malformed.
                counts["errors"] += 1
                low_text.writerow({
                    "resume_id": resume_id,
                    "category": category,
                    "relative_path": relative_path.as_posix(),
                    "pages": "",
                    "characters": 0,
                    "status": f"error:{type(error).__name__}",
                })
            if counts["pdfs"] % args.progress_every == 0:
                print(json.dumps({"processed": counts["pdfs"], **{key: value for key, value in counts.items() if key != "pdfs"}}), flush=True)

    print(json.dumps(counts, indent=2))
    print(f"Annotation import: {import_path}")
    print(f"Resume manifest: {manifest_path}")
    print(f"Scanned PDFs needing OCR or review: {low_text_path}")


if __name__ == "__main__":
    main()
