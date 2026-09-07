# CardioLens — AI-Assisted ECG Analysis Platform

Doctor-in-the-loop decision support for ECG reading. A multi-label 1D SE-ResNet
trained on [PTB-XL](https://physionet.org/content/ptb-xl/) scores 12-lead ECG
recordings for five diagnostic superclasses (NORM / MI / STTC / CD / HYP — a
record can carry several at once), waveform measurements are extracted from
the signal itself, and a guarded LLM narrative layer phrases it all into a
clinical report — downloadable as a one-page PDF — while the physician always
keeps the final call.

## Features

- **Multi-label SE-ResNet inference** — 7M-parameter 1D SE-ResNet trained on
  PTB-XL (21k records) in-process; five independent sigmoid outputs, not a
  softmax over mutually exclusive classes
- **Multi-format upload** — CSV, EDF, and WFDB record pairs (`.dat` + `.hea`)
- **Signal measurements** — heart rate, PR / QRS / QT / QTc intervals, and
  P / QRS / T axes computed from the waveform itself (median-beat delineation,
  Bazett correction); anything not measurable is reported as *unavailable*,
  never guessed
- **Structured case → guarded narrative** — the LLM only ever phrases the
  structured case object; a post-hoc numeric guardrail rejects any number not
  traceable to it (regenerate once, then deterministic template fallback)
- **One-page PDF report** — patient & measurements table, findings, diagnosis,
  category scores with thresholds, and the narrative — downloaded straight
  from the report card
- **Graceful degradation** — no API key? A rule-based template narrative is
  generated instead; the UI never breaks
- **Waveform review** — calibrated paper-style 12-lead ECG trace with flagged
  leads highlighted, so doctors can cross-check the analysis
- **Analysis history** — past results stored in SQLite, reloadable with one click

## How it works

```
upload ──► load (CSV / EDF / WFDB) ──► shared preprocessing (filter / resample /
                                           segment / z-score)
                                              │
                ┌─────────────────────────────┤
                ▼                             ▼
     [1] SE-ResNet (5 sigmoids)    [2] signal measurements
                │                    HR / PR / QRS / QT / QTc / axes
                └─────────────┬───────────────┘
                              ▼
                   [3] structured case JSON  ←─ the narrative's ONLY input
                              ▼
                   [4] LLM phrasing (Gemini)  ── numeric guardrail
                       (fallback: deterministic template)
                              ▼
                   [5] report card in the UI  ── one-page PDF download
```

The LLM never sees a waveform and never originates a number or a diagnosis —
it only phrases the Stage 3 case object, and a validator rejects any number
that does not exist in it. The same pipeline is developed and validated in
[training/ecg-train.ipynb](training/ecg-train.ipynb).

Preprocessing — one shared pipeline for training *and* inference
([`ml/preprocessing.py`](ml/preprocessing.py)):

1. Butterworth bandpass filter, 0.5–45 Hz
2. Resample to 500 Hz
3. Segment into 10-second windows
4. Per-lead z-score normalization

## Project structure

```
├── backend/                   FastAPI application
│   ├── api/routes.py          REST endpoints (upload, results, reports, PDF, health)
│   ├── services/              Analysis orchestration + the 5-stage report pipeline
│   │   ├── measurements.py    Stage 2 — HR/intervals/axes from the waveform
│   │   ├── clinical_report.py Stages 3-4 — case JSON + guarded LLM narrative
│   │   └── pdf_report.py      Stage 5 — one-page PDF (fpdf2)
│   ├── rag/                   Optional RAG module (not consumed by the report pipeline)
│   ├── models/                SQLAlchemy ORM models
│   ├── schemas/               Pydantic request/response schemas
│   ├── config.py              Settings (env-driven, pydantic-settings)
│   └── database.py            Engine + session management
├── ml/                        Shared ML code
│   ├── preprocessing.py       Signal loading + preprocessing pipeline
│   ├── inference.py           InferenceEngine (multi-label sigmoid, thresholds.json)
│   └── models/                resnet.py (SE-ResNet) + cnn_model.py (legacy 1D-CNN)
├── training/                  Model training
│   ├── ecg-train.ipynb        Kaggle notebook (multi-label training + report pipeline)
│   ├── dataset.py             PTB-XL PyTorch Dataset + metadata loading
│   └── train.py               Local training script
├── scripts/                   Utility scripts
├── frontend/                  Next.js 15 app (App Router, Tailwind v4)
├── models/weights/            resnet1d_multilabel_best.pth (committed) + thresholds.json (optional)
└── uploads/                   Uploaded recordings (gitignored)
```

## Prerequisites

- **Python 3.10+** — [python.org](https://www.python.org/downloads/)
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- *(optional)* **Gemini API key** for AI-generated reports — the free tier works —
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Quick start (Windows)

```bat
REM One-time setup: venv + Python deps + npm install + .env files
setup.bat

REM Starts the backend (:8000) and frontend (:3000)
run.bat
```

Then open **http://localhost:3000**.

## Quick start (macOS / Linux / manual)

```bash
# 1. Backend
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # Windows: copy .env.example .env
uvicorn backend.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
cp .env.local.example .env.local    # Windows: copy .env.local.example .env.local
npm run dev
```

Then open **http://localhost:3000**.

## Configuration

All backend settings live in `.env` (created from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `MOCK_INFERENCE` | `false` | `true` = randomized demo results, no model |
| `MODEL_PATH` | `./models/weights/resnet1d_multilabel_best.pth` | Multi-label SE-ResNet weights |
| `DATABASE_URL` | `sqlite:///./ecg_results.db` | SQLAlchemy connection string |
| `MAX_FILE_SIZE_MB` | `50` | Upload size limit |
| `ALLOWED_EXTENSIONS` | `csv,dat,hea,edf` | Accepted file types |
| `AI_API_KEY` | *(empty)* | Gemini API key — empty = template narrative |
| `AI_BASE_URL` | Gemini (OpenAI-compat) | Any OpenAI-compatible endpoint |
| `AI_MODEL` | `gemini-2.5-flash` | Model name |

The narrative layer works with any OpenAI-compatible provider — examples for
OpenAI, Groq, OpenRouter, and Ollama are documented in `.env.example`.

Per-class decision thresholds are read from
`models/weights/thresholds.json` (validation-tuned in the notebook). If the
file is absent, a 0.5 fallback is used for every class.

The frontend reads `NEXT_PUBLIC_API_URL` from `frontend/.env.local`
(default: `http://localhost:8000`).

## Uploading ECG recordings

| Format | How |
|---|---|
| **CSV** | One row per sample, one column per lead (12 leads) |
| **EDF** | Single file |
| **WFDB** | Select the `.dat` **and** `.hea` together in one upload — they form a pair |

The model expects **12-lead** recordings. Any sampling rate is accepted —
signals are resampled to 500 Hz during preprocessing.

## Optional: RAG guideline retrieval (legacy module)

The repository still ships a RAG module (`backend/rag/` + `scripts/build_index.py`)
that retrieves passages from AHA/ACCF/HRS guideline documents
([Surawicz 2009](data/guidelines/surawicz-2009.md)) via FAISS semantic search.
It is **not consumed by the current report pipeline** — the notebook-derived
pipeline keeps the LLM strictly on the structured case object — but the
infrastructure remains available for experiments:

```bat
python -m scripts.build_index    # one-time, ~30 seconds
```

## Training the model

Train on a free Kaggle GPU (T4) with
**[training/ecg-train.ipynb](training/ecg-train.ipynb)** — a multi-label SE-ResNet
over the five diagnostic superclasses (NORM/MI/STTC/CD/HYP), with signal
measurements, structured case reports, and PDF export built in:

1. Import the notebook on Kaggle and attach the PTB-XL dataset (Internet ON)
2. Run all cells (one-time ~10 min signal cache, then training with early stopping)
3. Download the resulting `resnet1d_multilabel_best.pth` **and `thresholds.json`**
   from the notebook's Output tab into `models/weights/`

The notebook reports per-class AUROC / AUPRC / F1 / sensitivity / specificity
on the untouched test fold (fold 10). The multi-label framing means a record
can carry several superclasses at once, so per-class metrics — not overall
accuracy — are the reference numbers. `thresholds.json` carries the
validation-tuned per-class decision thresholds used by the inference engine;
without it, a 0.5 fallback applies.

To train locally instead (download PTB-XL to `data/raw/ptbxl` first):

```bash
python -m training.train --data_dir ./data/raw/ptbxl --epochs 30 --device cuda
```

(Local `training/` scripts are the earlier single-label path; the Kaggle
notebook is the canonical multi-label trainer for the shipped weights.)

## API reference

Interactive docs: **http://localhost:8000/docs**

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload recording(s) → analysis result |
| `GET` | `/api/results` | Recent results |
| `GET` | `/api/results/{id}` | Single result |
| `GET` | `/api/results/{id}/report` | Full clinical report (case + measurements + narrative) |
| `GET` | `/api/results/{id}/report/pdf` | One-page PDF of the report (same cached narrative) |
| `GET` | `/api/health` | Service status |

## Tech stack

**Backend** — Python 3.10, FastAPI, SQLAlchemy (SQLite), Pydantic v2, httpx
**ML** — PyTorch (1D SE-ResNet, multi-label sigmoid), scipy (Butterworth filtering), wfdb (WFDB I/O)
**Reports** — LLM narrative via Gemini's OpenAI-compatible endpoint + numeric guardrail; fpdf2 for PDF export
**Frontend** — Next.js 15 (App Router), React 19, Tailwind CSS v4, Framer Motion

## Disclaimer

This platform is a research and education prototype for decision support.
It is **not** a certified medical device, its outputs are **not** diagnoses,
and it must not be used for clinical decision-making. The treating physician
is always responsible for interpretation.
