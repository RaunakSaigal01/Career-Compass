"""LoRA fine-tune a compact Qwen model on reviewed resume-to-JSON examples."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, get_peft_model
from torch.utils.data import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

from structured_pipeline import SYSTEM_PROMPT, build_user_prompt


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "qwen_prepared"
DEFAULT_OUTPUT = ROOT / "models" / "qwen_resume_json"
DEFAULT_BASE_MODEL = "Qwen/Qwen3-0.6B"


def template_ids(tokenizer, messages: list[dict[str, str]], *, add_generation_prompt: bool) -> list[int]:
    try:
        result = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=add_generation_prompt,
            enable_thinking=False,
        )
    except TypeError:
        result = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=add_generation_prompt,
        )
    # Transformers 5 returns a BatchEncoding even without return_tensors;
    # converting that mapping directly to a list yields key names, not tokens.
    if isinstance(result, dict) or hasattr(result, "__getitem__"):
        try:
            result = result["input_ids"]
        except (KeyError, TypeError, IndexError):
            pass
    if isinstance(result, torch.Tensor):
        result = result.tolist()
    if result and isinstance(result[0], list):
        if len(result) != 1:
            raise ValueError("Expected a single tokenized conversation")
        result = result[0]
    return [int(token_id) for token_id in result]


def common_prefix_length(left: list[int], right: list[int]) -> int:
    size = min(len(left), len(right))
    index = 0
    while index < size and left[index] == right[index]:
        index += 1
    return index


class ResumeDataset(Dataset):
    def __init__(self, path: Path, tokenizer, max_seq_length: int):
        if not path.is_file():
            raise SystemExit(f"Prepared split is missing: {path}")
        self.items: list[dict[str, list[int]]] = []
        with path.open(encoding="utf-8-sig") as source:
            for line_number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                target = json.dumps(row["target"], ensure_ascii=False, separators=(",", ":"))
                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(row["text"])},
                ]
                prompt_ids = template_ids(tokenizer, messages, add_generation_prompt=True)
                full_ids = template_ids(tokenizer, messages + [{"role": "assistant", "content": target}], add_generation_prompt=False)
                prefix = common_prefix_length(prompt_ids, full_ids)
                if prefix != len(prompt_ids):
                    # Some templates append a different assistant prefix in training mode.
                    prefix = common_prefix_length(prompt_ids[:-1], full_ids)
                if len(full_ids) > max_seq_length:
                    resume_id = row.get("resume_id", f"line {line_number}")
                    raise SystemExit(
                        f"Sequence for {resume_id} is {len(full_ids)} tokens, over --max-seq-length={max_seq_length}. "
                        "Increase the limit if GPU memory permits or remove this unusually long example after review."
                    )
                if prefix >= len(full_ids):
                    raise SystemExit(f"Could not separate prompt from target for {row.get('resume_id', line_number)}")
                labels = [-100] * prefix + full_ids[prefix:]
                self.items.append({"input_ids": full_ids, "labels": labels})
        if not self.items:
            raise SystemExit(f"Prepared split is empty: {path}")

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        return self.items[index]


class CausalCollator:
    def __init__(self, tokenizer):
        self.pad_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
        max_len = max(len(item["input_ids"]) for item in features)
        input_ids, attention_mask, labels = [], [], []
        for item in features:
            pad_len = max_len - len(item["input_ids"])
            input_ids.append(item["input_ids"] + [self.pad_id] * pad_len)
            attention_mask.append([1] * len(item["input_ids"]) + [0] * pad_len)
            labels.append(item["labels"] + [-100] * pad_len)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attention_mask, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise SystemExit(f"Prepared split is missing: {path}")
    with path.open(encoding="utf-8-sig") as source:
        rows = [json.loads(line) for line in source if line.strip()]
    if not rows:
        raise SystemExit(f"Prepared split is empty: {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--max-seq-length", type=int, default=8192)
    args = parser.parse_args()

    if args.output.exists():
        raise SystemExit(f"Output exists; choose a new path to avoid overwriting: {args.output}")
    if args.epochs <= 0 or args.batch_size < 1 or args.gradient_accumulation < 1:
        raise SystemExit("Epochs, batch size, and gradient accumulation must be positive")
    if args.max_seq_length < 1024:
        raise SystemExit("--max-seq-length must be at least 1024")

    train_rows = load_rows(args.data / "train.jsonl")
    dev_rows = load_rows(args.data / "dev.jsonl")
    load_rows(args.data / "test.jsonl")  # Require a held-out set before training.
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.base_model, dtype=dtype)
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    lora = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    train_dataset = ResumeDataset(args.data / "train.jsonl", tokenizer, args.max_seq_length)
    eval_dataset = ResumeDataset(args.data / "dev.jsonl", tokenizer, args.max_seq_length)
    args.output.mkdir(parents=True, exist_ok=False)
    training_args = TrainingArguments(
        output_dir=str(args.output / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.gradient_accumulation,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=10,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        fp16=device == "cuda",
        use_cpu=device == "cpu",
        dataloader_num_workers=0,
        report_to="none",
        remove_unused_columns=False,
        optim="adamw_torch",
        seed=42,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=CausalCollator(tokenizer),
        processing_class=tokenizer,
    )
    trainer.train()
    model_path = args.output / "model-best"
    trainer.save_model(str(model_path))
    tokenizer.save_pretrained(model_path)
    metadata = {
        "base_model": args.base_model,
        "device": device,
        "train_documents": len(train_rows),
        "dev_documents": len(dev_rows),
        "epochs": args.epochs,
        "max_seq_length": args.max_seq_length,
    }
    (args.output / "training.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({**metadata, "model": str(model_path)}, indent=2))


if __name__ == "__main__":
    main()
