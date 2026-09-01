# CardioLens — AI-Assisted ECG Analysis Platform

Doctor-in-the-loop decision support for ECG reading. A 1D-CNN trained on
[PTB-XL](https://physionet.org/content/ptb-xl/) scores 12-lead ECG recordings
for five diagnostic superclasses, flags suspected abnormalities with
confidence scores, and an AI report generator (Gemini) writes a clinical
summary — while the physician always keeps the final call.

## Features

- **Real CNN inference** — 187K-parameter 1D-CNN trained on PTB-XL (21k records), served in-process
- **Multi-format upload** — CSV, EDF, and WFDB record pairs (`.dat` + `.hea`)
- **Automatic AI clinical report** — generated right after each analysis: per-flag explanations in clinical terms, an attention level, prioritized follow-up actions, and honest limitations
- **Graceful degradation** — no API key? A rule-based template report is generated instead; the UI never breaks
- **Waveform review** — ECG trace with flagged regions, so doctors can cross-check the model
- **Analysis history** — past results stored in SQLite, reloadable with one click

## How it works

```
upload ──► load (CSV / EDF / WFDB) ──► preprocessing ──► 1D-CNN ──► softmax over 5 superclasses
                                              │                              │
                          shared pipeline     │         flags (prob ≥ 0.15) ◄─┘
                                              ▼
                       result ──► SQLite ──► history table
                            └──► AI report (Gemini / template fallback)
```

Preprocessing — one shared pipeline for training *and* inference
([`ml/preprocessing.py`](ml/preprocessing.py)):

1. Butterworth bandpass filter, 0.5–45 Hz
2. Resample to 500 Hz
3. Segment into 10-second windows
4. Per-lead z-score normalization

## Project structure

```
├── backend/                   FastAPI application
│   ├── api/routes.py          REST endpoints (upload, results, reports, health)
│   ├── services/              Analysis orchestration + AI report generation
│   ├── models/                SQLAlchemy ORM models
│   ├── schemas/               Pydantic request/response schemas
│   ├── config.py              Settings (env-driven, pydantic-settings)
│   └── database.py            Engine + session management
├── ml/                        Shared ML code
│   ├── preprocessing.py       Signal loading + preprocessing pipeline
│   ├── inference.py           InferenceEngine (loads weights once, reuses)
│   └── models/cnn_model.py    1D-CNN architecture
├── training/                  Model training
│   ├── kaggle_train.ipynb     Kaggle notebook (produced the shipped weights)
│   ├── dataset.py             PTB-XL PyTorch Dataset + metadata loading
│   └── train.py               Local training script
├── frontend/                  Next.js 15 app (App Router, Tailwind v4)
├── models/weights/            Trained weights (best_model.pth — committed)
├── data/raw/                  PTB-XL dataset goes here (gitignored)
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
| `MODEL_PATH` | `./models/weights/best_model.pth` | Trained CNN weights |
| `DATABASE_URL` | `sqlite:///./ecg_results.db` | SQLAlchemy connection string |
| `MAX_FILE_SIZE_MB` | `50` | Upload size limit |
| `ALLOWED_EXTENSIONS` | `csv,dat,hea,edf` | Accepted file types |
| `AI_API_KEY` | *(empty)* | Gemini API key — empty = template reports |
| `AI_BASE_URL` | Gemini (OpenAI-compat) | Any OpenAI-compatible endpoint |
| `AI_MODEL` | `gemini-2.5-flash` | Model name |

The AI report works with any OpenAI-compatible provider — examples for
OpenAI, Groq, OpenRouter, and Ollama are documented in `.env.example`.

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

## Training the model

The shipped `best_model.pth` was trained with
**[training/kaggle_train.ipynb](training/kaggle_train.ipynb)** on a free Kaggle
GPU (T4):

1. Upload the notebook to Kaggle and attach the PTB-XL dataset
2. Run all cells (~25–30 epochs)
3. Drop the resulting `best_model.pth` into `models/weights/`

To train locally instead (download PTB-XL to `data/raw/ptbxl` first):

```bash
python -m training.train --data_dir ./data/raw/ptbxl --epochs 30 --device cuda
```

### Reference metrics (shipped weights, PTB-XL validation)

| Metric | Value |
|---|---|
| Accuracy | 75.6% |
| Macro F1 | 0.658 |
| False-negative rate | 0.36 |
| False-positive rate | 0.07 |

The false-negative rate is the project's core metric — for a screening tool,
a missed abnormality costs more than a false alarm. The flag threshold
(0.15 in [`ml/inference.py`](ml/inference.py)) is the knob that trades one
against the other.

## API reference

Interactive docs: **http://localhost:8000/docs**

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload recording(s) → analysis result |
| `GET` | `/api/results` | Recent results |
| `GET` | `/api/results/{id}` | Single result |
| `GET` | `/api/results/{id}/report` | AI clinical report |
| `GET` | `/api/health` | Service status |

## Tech stack

**Backend** — Python 3.10, FastAPI, SQLAlchemy (SQLite), Pydantic v2, httpx
**ML** — PyTorch (1D-CNN), scipy (Butterworth filtering), wfdb (WFDB I/O)
**Frontend** — Next.js 15 (App Router), React 19, Tailwind CSS v4, Framer Motion
**AI reports** — Gemini via its OpenAI-compatible endpoint

## Disclaimer

This platform is a research and education prototype for decision support.
It is **not** a certified medical device, its outputs are **not** diagnoses,
and it must not be used for clinical decision-making. The treating physician
is always responsible for interpretation.
