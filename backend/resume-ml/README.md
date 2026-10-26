# Resume PDF extraction model

This folder contains local OCR, structured-annotation, model training, evaluation, and inference workflows for resumes. The recommended path trains a small Qwen model to return structured JSON; the existing GLiNER scripts remain available for entity-span experiments. The existing NestJS parser remains a separate fallback and continues to handle PDF/DOCX text extraction, section splitting, and dictionary skill matching.

## Important: the PDF folders are not training labels

The folders under `backend/Resumes PDF` supply broad job-category metadata, but they do not provide verified extraction answers. Having 8,905 PDFs does not mean there are 8,905 training examples. Train only on reviewed resume-to-JSON pairs, and keep a separate reviewed test split.

## Fields the model should extract

Train one complete structured JSON target for each resume's OCR text. This is information extraction into fields, rather than assigning one class to the whole resume. The current canonical schema covers the requested sections:

| Requested field | Canonical JSON field |
| --- | --- |
| Full name | `full_name` |
| Email | `email` |
| Phone | `phone` |
| LinkedIn | `linkedin` |
| GitHub | `github` |
| Skills | `skills` (JSON array of strings; display by joining with commas) |
| Summary | `summary` |
| Experience | `experience` (one string per position, grouping its stated details) |
| Education | `education` (one string per qualification) |
| Projects | `projects` (one string per project) |
| Certifications | `certifications` (one string per certification) |

Example target for a single resume:

```json
{
  "full_name": "Asha Kumar",
  "email": "asha@example.com",
  "phone": "+91 9876543210",
  "linkedin": "https://www.linkedin.com/in/asha-kumar",
  "github": "https://github.com/ashakumar",
  "skills": ["Python", "Django", "PostgreSQL"],
  "summary": "Software engineer with experience building web applications.",
  "experience": [
    "Software Engineer at Example Ltd, 2022–2025: Built internal web applications."
  ],
  "education": [
    "B.Tech in Computer Science, Example University, 2022."
  ],
  "projects": [
    "Expense Tracker: A web app for tracking expenses using Django and PostgreSQL."
  ],
  "certifications": [
    "AWS Certified Cloud Practitioner, Amazon Web Services, 2024."
  ]
}
```

This shape has exactly 11 keys. Use `null` for a missing single value and an empty array for a missing repeated section. Keep each job, school, project, and certification as a separate string entry. Do not guess or attach a nearby date/company to the wrong entry. The existing 8,905 PDFs are inputs only; they do not contain these verified target JSON labels. The pilot must be reviewed against the OCR text before any of its records are used for training.

## Recommended workflow: reviewed structured JSON and Qwen LoRA

This workflow avoids drawing every entity span in Doccano. A local Qwen model creates draft JSON, a local browser page lets you review each structured record against its OCR text, and only records you explicitly save as reviewed enter the training split. Resume text stays on this machine; the generator does not call a cloud API.

The current workspace already has a stratified OCR batch under `data/training_sample/raw/` and 386 resumes. The existing GLiNER suggestions are not structured ground truth and are not used as targets by this workflow.

Install the training dependencies from this directory:

```powershell
python -m pip install -r requirements-structured.txt
```

Generate local draft extractions. The first run downloads the public `Qwen/Qwen3-0.6B` model weights; subsequent runs reuse the local cache. Long resumes are processed in overlapping excerpts, and partial runs can be resumed:

```powershell
python scripts/generate_structured_drafts.py --input data/training_sample/raw/doccano_import.jsonl --manifest data/training_sample/raw/manifest.csv --output data/structured/drafts.jsonl
```

If downloading Qwen is unavailable, the prepared batch has GLiNER span suggestions. They are noisy candidate highlights, not extracted facts. Create a clean review pilot without pre-filling any JSON field:

```powershell
python scripts/gliner_structured_drafts.py --input data/training_sample/gliner_suggestions.jsonl --manifest data/training_sample/raw/manifest.csv --output data/structured/drafts_no_pairing.jsonl --limit 10
```

All structured fields start empty. Suggestions remain visible with their source-line context, but must be checked against the resume and entered into JSON manually. No proximity-based assignment is performed. Omit `--limit 10` to prepare all 386 rows.

Open the local review page:

```powershell
python scripts/review_structured_drafts.py --input data/structured/drafts_no_pairing.jsonl --output data/structured/reviewed_no_pairing.jsonl
```

The page opens at `http://127.0.0.1:8765`. For every resume, check each field against the source text, fix or remove unsupported values, add omissions, and save. Saving confirms that the entire resume was reviewed, including fields that should remain empty. Stop the local page with `Ctrl+C` when finished.

The old `data/structured/reviewed.jsonl` pilot was made from proximity-paired suggestions and should not be used as training data. Keep it as a record, and use the new separately named review file. Validate reviewed records and create deterministic category-stratified train/dev/test JSONL files:

```powershell
python scripts/prepare_qwen_data.py --annotations data/structured/reviewed_no_pairing.jsonl --manifest data/training_sample/raw/manifest.csv --output data/qwen_prepared
```

Inspect `data/qwen_prepared/summary.json`. It reports counts, not resume content. The current 386-resume batch is a pilot: it is useful for checking the annotation workflow and training feasibility, but it is too small to claim production accuracy.

Fine-tune the base model using LoRA adapters:

```powershell
python scripts/train_qwen_json.py --data data/qwen_prepared --output models/qwen_resume_json
```

Evaluate the saved adapter only on the held-out test split:

```powershell
python scripts/evaluate_qwen_json.py --test data/qwen_prepared/test.jsonl --adapter models/qwen_resume_json/model-best --report data/reports/qwen_json_eval.json
```

The report includes per-field precision/recall/F1, exact-record match, parse failures, and inference time. Review errors from the held-out set before deciding whether to expand the training batch. Never move test examples into training after looking at their results.

### Hardware and research limits

The current resume-model environment has CPU-only PyTorch even though the machine has an NVIDIA GPU. Draft generation and training therefore run on CPU until a CUDA-enabled PyTorch build is installed. Qwen3-0.6B was chosen as a compact starting point; quality must be measured on this dataset.

The cited resume-extraction paper reports a larger system, not a guarantee for this project: it uses layout-aware preprocessing and reports 15,500 resumes / 59,500 human-verified instruction samples for fine-tuning. Its 0.846 F1 number is for long-text fields in one evaluation group. See [the paper](https://arxiv.org/abs/2510.09722).

The local review tool binds only to `127.0.0.1`. Keep generated JSON, reviewed annotations, and model weights in the ignored `data/` and `models/` directories because they contain personal information.

## Optional workflow: GLiNER entity-span model

The following older flow trains a named-entity span model. It can remain useful for individual spans such as names, emails, and skills, but does not build experience or education records.

## 1. Create a local Python environment

Use Python 3.11 or 3.12 (64-bit), then from this directory:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Keep resume files, annotations, and trained model weights local. This project ignores the generated `data/`, `models/`, and `logs/` directories because they can contain personal information.

## 2. Build a stratified OCR pilot

Start with two resumes from each immediate category folder. This creates a pilot separate from the full corpus output:

```powershell
python scripts/prepare_dataset.py --output data/pilot/raw --ocr --ocr-dpi 200 --sample-per-category 2 --progress-every 25
```

With 97 folders this selects up to 97 resumes. The script samples deterministically by folder, extracts embedded text first, and uses RapidOCR with ONNX Runtime only on pages with little embedded text. It writes `data/pilot/raw/doccano_import.jsonl`, `manifest.csv`, and `needs_ocr.csv`. Resume text stays local. Use the pilot to review OCR quality before expanding the annotation sample; the entire corpus is not needed to validate the approach.

To process the whole PDF corpus after the pilot looks good, omit `--sample-per-category` and set the output back to the raw corpus folder:

```powershell
python scripts/prepare_dataset.py --output data/raw --ocr --ocr-dpi 200 --progress-every 100
```

This full pass can take many hours on CPU. It leaves the source PDFs unchanged.

## 3. Prepare the annotation batch and model suggestions

Create a larger stratified annotation batch (four resumes per folder, up to about 388 files):

```powershell
python scripts/prepare_dataset.py --output data/training_sample/raw --ocr --ocr-dpi 200 --sample-per-category 4 --progress-every 25
```

Install the optional pretrained extractor and generate editable suggestions:

```powershell
pip install -r requirements-gliner.txt
python scripts/gliner_suggestions.py --input data/training_sample/raw/doccano_import.jsonl --output data/training_sample/gliner_suggestions.jsonl
```

The first run downloads the pretrained GLiNER weights. Predictions are draft suggestions, not labels. Review OCR and correct every selected resume in a local sequence-labeling tool before using the annotations for training.

## 4. Correct the model suggestions

Run a self-hosted Doccano instance or another trusted local sequence-labeling tool. Create a sequence-labeling project and import `data/training_sample/gliner_suggestions.jsonl`. Do not upload resumes to a third-party annotation service unless you have permission and an appropriate privacy agreement.

The batch has up to about 388 varied resumes across the 97 folders. Label exact spans consistently, using this initial label set:

`PERSON`, `EMAIL`, `PHONE`, `URL`, `SKILL`, `DEGREE`, `SCHOOL`, `COMPANY`, `JOB_TITLE`, `DATE`.

Review each resume completely, including confirming that fields not present really are absent. An unmarked field is treated as a negative training example. Keep the exported text byte-for-byte equivalent to the imported text; the converter uses a normalized content hash to match it back to the manifest.

Export corrected annotations in Doccano JSONL format as `data/training_sample/annotations.jsonl`. It should contain `text` and `labels` fields, with each span represented as `[start, end, label]` character offsets.

## 5. Convert annotations into GLiNER training splits

```powershell
python scripts/convert_gliner_annotations.py --annotations data/training_sample/annotations.jsonl --manifest data/training_sample/raw/manifest.csv --output data/gliner_prepared
```

The converter validates offsets and overlap, maps character spans to GLiNER word spans, and writes deterministic category-stratified train, development, and held-out test files. Inspect `summary.json`; if a label has too few reviewed examples, annotate more examples before training.

## 6. Fine-tune the pretrained model

```powershell
python scripts/train_gliner.py --data data/gliner_prepared --output models/resume_gliner
```

The script fine-tunes from the pretrained small checkpoint, uses the development split to select a checkpoint, and saves the result under `models/resume_gliner/model-best`. It uses CPU if the installed PyTorch build cannot access CUDA.

## 7. Evaluate before using it

```powershell
python scripts/evaluate_gliner.py --model models/resume_gliner/model-best --test data/gliner_prepared/test.json
```

Use the held-out test set only for final evaluation, not repeated tuning. Review per-label precision, recall, and F1, plus actual false positives and missed fields on resumes from different layouts. Set explicit acceptance thresholds for the fields your application displays. NER returns spans; it does not by itself validate email/phone formats, infer work-history relationships, or guarantee that a listed skill is genuinely possessed. Keep deterministic validation and skill normalization in the NestJS layer.

## 8. Start the local inference service

From this directory, with the virtual environment active:

```powershell
$env:RESUME_NER_BACKEND = "gliner"
$env:RESUME_NER_MODEL_PATH = ".\models\resume_gliner\model-best"
uvicorn app:app --host 127.0.0.1 --port 8010 --workers 1
```

`GET /health` reports whether the trained model loaded. `POST /extract` accepts `{"text":"..."}` and returns entity spans. The service binds to localhost and uses one worker to avoid loading a separate model copy per worker. Do not expose it to the public network without adding authentication and request limits.

## 9. Opt NestJS into the validated model

Add these settings to `backend/.env` only after training and evaluation:

```dotenv
RESUME_ML_URL=http://127.0.0.1:8010
RESUME_ML_PRIMARY=true
RESUME_ML_TIMEOUT_MS=2500
```

With `RESUME_ML_PRIMARY=true`, NestJS calls the local model and uses it instead of Gemini when it returns valid entities. It merges model results with deterministic contact and skill extraction. If the local service is missing, times out, returns an error, or returns no entities, the existing Gemini/deterministic path remains available. Leave `RESUME_ML_PRIMARY` unset until your held-out evaluation is acceptable. Resume text is sent to the local service only when both `RESUME_ML_URL` is configured and primary mode is enabled.

## Accuracy and speed improvements after the first model

- Annotate error cases found in the held-out review and retrain with a fixed seed/data version.
- Improve PDF text extraction and OCR quality before changing model size.
- Keep email and phone validation deterministic; normalize skills against the app's existing dictionary.
- Consider a separate relationship/normalization layer for education and experience records, because NER alone does not group fields into records.
- Track model version, annotation version, per-label metrics, and inference latency without logging resume contents.
- Keep a deterministic/Gemini fallback until real production-like resumes show stable quality.
