"""Private local inference API for the trained resume entity extractor."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent

# Check for Qwen2.5 300-corpus GPU model first, then previous GPU models, then NER
QWEN25_300_PATH = ROOT / "models" / "qwen25_resume_gpu_300" / "model-best"
QWEN25_PATH = ROOT / "models" / "qwen25_resume_gpu" / "model-best"
QWEN3_PATH = ROOT / "models" / "qwen_resume_gpu" / "model-best"
NER_PATH = ROOT / "models" / "resume_ner" / "model-best"

if QWEN25_300_PATH.exists():
    DEFAULT_PATH = QWEN25_300_PATH
    DEFAULT_BACKEND = "qwen"
    DEFAULT_BASE = "Qwen/Qwen2.5-0.5B-Instruct"
elif QWEN25_PATH.exists():
    DEFAULT_PATH = QWEN25_PATH
    DEFAULT_BACKEND = "qwen"
    DEFAULT_BASE = "Qwen/Qwen2.5-0.5B-Instruct"
elif QWEN3_PATH.exists():
    DEFAULT_PATH = QWEN3_PATH
    DEFAULT_BACKEND = "qwen"
    DEFAULT_BASE = "Qwen/Qwen3-0.6B"
else:
    DEFAULT_PATH = NER_PATH
    DEFAULT_BACKEND = "spacy"
    DEFAULT_BASE = "Qwen/Qwen2.5-0.5B-Instruct"

MODEL_PATH = Path(os.getenv("RESUME_NER_MODEL_PATH", str(DEFAULT_PATH)))
MODEL_BACKEND = os.getenv("RESUME_NER_BACKEND", DEFAULT_BACKEND).strip().lower()
BASE_MODEL_NAME = os.getenv("RESUME_BASE_MODEL", DEFAULT_BASE)
MAX_TEXT_CHARS = int(os.getenv("RESUME_NER_MAX_TEXT_CHARS", "150000"))
GLINER_LABELS = {
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

model = None
tokenizer = None
device = None
model_load_error: str | None = None
if MODEL_PATH.exists():
    try:
        if MODEL_BACKEND == "qwen":
            import torch
            from peft import PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            dtype = torch.float16 if device.type == "cuda" else torch.float32
            tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL_NAME)
            base_model = AutoModelForCausalLM.from_pretrained(BASE_MODEL_NAME, dtype=dtype)
            model = PeftModel.from_pretrained(base_model, str(MODEL_PATH))
            model.to(device)
            model.eval()
        elif MODEL_BACKEND == "gliner":
            from gliner import GLiNER

            model = GLiNER.from_pretrained(str(MODEL_PATH))
        elif MODEL_BACKEND == "spacy":
            import spacy

            model = spacy.load(MODEL_PATH)
            model.max_length = max(model.max_length, MAX_TEXT_CHARS)
        else:
            raise ValueError("RESUME_NER_BACKEND must be 'qwen', 'spacy', or 'gliner'.")
    except Exception as error:
        model_load_error = type(error).__name__

app = FastAPI(title="Resume Entity Extractor", version="1.0.0")


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ready" if model is not None else "model_not_trained",
        "model_loaded": model is not None,
        "model_path": str(MODEL_PATH),
        "model_backend": MODEL_BACKEND,
        "device": str(device) if device else None,
        "load_error": model_load_error,
    }


@app.post("/extract")
def extract(request: ExtractRequest) -> dict[str, Any]:
    if model is None:
        raise HTTPException(status_code=503, detail="Resume extraction model has not been trained or could not be loaded.")

    if MODEL_BACKEND == "qwen":
        import torch
        from scripts.structured_pipeline import SYSTEM_PROMPT, build_user_prompt, parse_json_object

        sample_text = request.text[:2200]
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(sample_text)},
        ]
        inp = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
        if hasattr(inp, "data") and "input_ids" in inp.data:
            input_ids = inp.data["input_ids"].to(device)
        elif hasattr(inp, "__getitem__") and "input_ids" in inp:
            input_ids = inp["input_ids"].to(device)
        else:
            input_ids = inp.to(device)

        with torch.inference_mode():
            out = model.generate(input_ids=input_ids, max_new_tokens=400, do_sample=False, use_cache=True)

        resp_text = tokenizer.decode(out[0][input_ids.shape[1]:], skip_special_tokens=True)
        try:
            parsed = parse_json_object(resp_text)
        except Exception:
            parsed = {}

        entities = []
        full_name = parsed.get("full_name")
        if full_name and isinstance(full_name, str):
            idx = request.text.lower().find(full_name.lower())
            start = idx if idx != -1 else 0
            entities.append({
                "text": full_name,
                "label": "PERSON",
                "start": start,
                "end": start + len(full_name),
            })

        for skill in parsed.get("skills", []):
            if isinstance(skill, str) and skill.strip():
                idx = request.text.lower().find(skill.lower())
                start = idx if idx != -1 else 0
                entities.append({
                    "text": skill,
                    "label": "SKILL",
                    "start": start,
                    "end": start + len(skill),
                })

        return {
            "entities": entities,
            "structured": parsed,
        }
    elif MODEL_BACKEND == "gliner":
        entities = []
        text = request.text
        start = 0
        while start < len(text):
            end = min(len(text), start + 1400)
            if end < len(text):
                boundary = text.rfind("\n", start + 700, end)
                if boundary > start:
                    end = boundary
            for entity in model.predict_entities(
                text[start:end], list(GLINER_LABELS), threshold=0.45
            ):
                label = GLINER_LABELS.get(str(entity.get("label", "")).casefold())
                if label:
                    entities.append({
                        "text": entity["text"],
                        "label": label,
                        "start": int(entity["start"]) + start,
                        "end": int(entity["end"]) + start,
                    })
            if end == len(text):
                break
            start = max(start + 1, end - 120)
        return {"entities": entities}
    else:
        doc = model(request.text)
        entities = [
            {"text": entity.text, "label": entity.label_, "start": entity.start_char, "end": entity.end_char}
            for entity in doc.ents
        ]
        return {
            "entities": entities
        }


class OcrPdfRequest(BaseModel):
    file_path: str = Field(min_length=1)


@app.post("/ocr-pdf")
def ocr_pdf(req: OcrPdfRequest) -> dict[str, Any]:
    from scripts.ocr_pdf import extract_pdf_text

    text = extract_pdf_text(req.file_path)
    return {"text": text}

