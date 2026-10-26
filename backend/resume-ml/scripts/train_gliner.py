"""Fine-tune the pretrained GLiNER model from corrected pilot annotations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from gliner import GLiNER


ROOT = Path(__file__).resolve().parents[1]


def read_split(path: Path) -> list[dict]:
    if not path.is_file():
        raise SystemExit(f"Prepared split is missing: {path}")
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not rows:
        raise SystemExit(f"Prepared split is empty: {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "gliner_prepared")
    parser.add_argument("--output", type=Path, default=ROOT / "models" / "resume_gliner")
    parser.add_argument("--base-model", default="gliner-community/gliner_small-v2.5")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=1.5e-5)
    args = parser.parse_args()

    if args.output.exists():
        raise SystemExit(f"Output already exists; choose a new --output path: {args.output}")
    train_rows = read_split(args.data / "train.json")
    dev_rows = read_split(args.data / "dev.json")
    read_split(args.data / "test.json")  # Require a held-out test set before training.

    model = GLiNER.from_pretrained(args.base_model)
    args.output.mkdir(parents=True, exist_ok=False)
    trainer = model.train_model(
        train_dataset=train_rows,
        eval_dataset=dev_rows,
        output_dir=str(args.output / "checkpoints"),
        learning_rate=args.learning_rate,
        others_lr=args.learning_rate,
        weight_decay=0.01,
        num_train_epochs=args.epochs,
        max_steps=-1,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=10,
        dataloader_num_workers=0,
        use_cpu=not torch.cuda.is_available(),
        bf16=False,
        report_to="none",
    )
    trainer.model.save_pretrained(args.output / "model-best")
    print(json.dumps({"model": str(args.output / 'model-best'), "device": "cuda" if torch.cuda.is_available() else "cpu"}, indent=2))


if __name__ == "__main__":
    main()
