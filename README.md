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
- **RAG-grounded reports** — AI reports cite AHA/ACCF/HRS guideline criteria (Surawicz 2009) via FAISS semantic retrieval, so explanations reference specific diagnostic thresholds (e.g., Sokolow-Lyon, STEMI ≥2 mm in V2–V3)
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
                            └──► AI report:
                                   RAG retriever ──► FAISS search over guidelines
                                   context + result ──► LLM (Gemini) ──► clinical report
                                   (fallback: template if no key or no index)
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
│   ├── rag/                   RAG module (indexer, retriever, pipeline)
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
├── scripts/                   Utility scripts
│   └── build_index.py         Build FAISS index from guideline documents
├── frontend/                  Next.js 15 app (App Router, Tailwind v4)
├── models/weights/            Trained weights (best_model.pth — committed)
├── data/guidelines/           Clinical guideline .md files (Surawicz 2009)
├── data/index/                FAISS index artefacts (built by scripts/build_index.py)
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
| `RAG_ENABLED` | `false` | `true` = ground AI reports in guideline criteria via FAISS retrieval |
| `RAG_INDEX_DIR` | `data/index` | Path to built FAISS index directory |
| `RAG_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | sentence-transformers model (384-dim, 22 M params) |
| `RAG_MAX_QUERIES` | `5` | Max retrieval queries per report request |

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

## RAG — Grounding AI Reports in Clinical Guidelines

The RAG (Retrieval-Augmented Generation) module retrieves relevant passages from
authoritative guidelines before the LLM writes each report. This means the AI
cites **specific diagnostic criteria** (e.g., "per AHA/ACCF/HRS, STEMI requires
≥2 mm ST elevation in V2–V3") instead of generating vague explanations.

### How RAG works

```
ECG result (flags + confidences)
    │
    ▼
query builder → 3–5 clinical queries per flagged superclass
    │
    ▼
FAISS retriever → cosine similarity over 50 guideline chunks
    │                 (all-MiniLM-L6-v2, 384-dim embeddings)
    ▼
top-k passages → injected into LLM prompt as clinical context
    │
    ▼
Gemini writes report grounded in Surawicz 2009 criteria
```

### Setup

```bat
REM 1. Build the FAISS index (one-time, ~30 seconds)
python -m scripts.build_index

REM 2. Enable RAG in .env
REM    RAG_ENABLED=true

REM 3. Restart the backend — reports now cite guidelines
```

### Guideline source

The shipped guideline is [`data/guidelines/surawicz-2009.md`](data/guidelines/surawicz-2009.md) —
a structured markdown conversion of:

> Surawicz B, Childers R, Deal BJ, et al. *AHA/ACCF/HRS Recommendations for
> the Standardization and Interpretation of the Electrocardiogram.*
> Circulation. 2009;119:e262–e308.

To add more guidelines, drop additional `.md` files into `data/guidelines/` and
rebuild the index. The chunker splits on H1/H2/H3 headings with configurable
overlap.

### Architecture

| Module | File | Role |
|---|---|---|
| Indexer | [`backend/rag/indexer.py`](backend/rag/indexer.py) | Chunk markdown, embed with sentence-transformers, build FAISS IndexFlatIP |
| Retriever | [`backend/rag/retriever.py`](backend/rag/retriever.py) | Load index, semantic search, format context; singleton per process |
| Pipeline | [`backend/rag/pipeline.py`](backend/rag/pipeline.py) | Build queries from ECG flags, retrieve passages, assemble LLM context |
| Report service | [`backend/services/ai_report.py`](backend/services/ai_report.py) | Injects RAG context into user prompt; degrades gracefully if disabled |
| Build script | [`scripts/build_index.py`](scripts/build_index.py) | CLI: `python -m scripts.build_index [--docs_dir DIR] [--model NAME]` |

### Graceful degradation

RAG is fully optional. If `RAG_ENABLED=false`, the index doesn't exist, or
retrieval returns no hits, the report falls through cleanly to the standard
LLM or template path. The `rag_used` field in the response tells the frontend
whether guideline context was included.

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
**RAG** — sentence-transformers (all-MiniLM-L6-v2), FAISS (flat inner-product), markdown chunker
**Frontend** — Next.js 15 (App Router), React 19, Tailwind CSS v4, Framer Motion
**AI reports** — Gemini via its OpenAI-compatible endpoint (RAG-grounded in AHA/ACCF/HRS guidelines)

## Disclaimer

This platform is a research and education prototype for decision support.
It is **not** a certified medical device, its outputs are **not** diagnoses,
and it must not be used for clinical decision-making. The treating physician
is always responsible for interpretation.
