from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List
import shutil
from pathlib import Path
from datetime import datetime

from backend.config import settings
from backend.database import get_db
from backend.schemas.ecg import (
    ECGUploadResponse,
    ECGResultResponse,
    FlaggedRegionSchema,
)
from backend.models.ecg_result import ECGResult
from backend.services.ecg_analyzer import analyze_ecg
from backend.services.ai_report import generate_ai_report


router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def _ext(filename: str | None) -> str:
    return filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else ""


def _validate_files(files: List[UploadFile]) -> None:
    """Validate the upload set: single CSV/EDF, or a matched WFDB .dat + .hea pair."""
    if not files or all(f.filename is None for f in files):
        raise HTTPException(status_code=400, detail="No file provided")

    for f in files:
        if _ext(f.filename) not in settings.allowed_extensions_list:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type '{f.filename}'. "
                       f"Allowed: {settings.allowed_extensions}",
            )

    if len(files) == 1:
        if _ext(files[0].filename) in ("dat", "hea"):
            raise HTTPException(
                status_code=422,
                detail="WFDB records are a .dat + .hea pair — select both files "
                       "together in one upload.",
            )
        return

    if len(files) == 2:
        exts = sorted(_ext(f.filename) for f in files)
        if exts == ["dat", "hea"]:
            stems = {Path(f.filename).stem for f in files}  # type: ignore[arg-type]
            if len(stems) == 1:
                return
            raise HTTPException(
                status_code=422,
                detail="WFDB .dat and .hea files must share the same base name "
                       f"(got: {', '.join(sorted(f.filename or '' for f in files))}).",
            )
        raise HTTPException(
            status_code=422,
            detail="When uploading two files, they must be a WFDB pair: "
                   "one .dat and one .hea with the same base name.",
        )

    raise HTTPException(
        status_code=422,
        detail="Upload a single CSV/EDF file, or a WFDB pair (.dat + .hea "
               "with the same base name) selected together.",
    )


@router.post("/upload", response_model=ECGUploadResponse)
async def upload_ecg(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    """
    Upload ECG recording(s) for analysis.

    - Single file: CSV or EDF
    - WFDB: select BOTH the .dat and .hea files together (one request) —
      they share a base name, e.g. 00001_hr.dat + 00001_hr.hea
    """
    _validate_files(files)

    # Each upload gets its own timestamped subdirectory, keeping ORIGINAL
    # filenames inside. This matters for WFDB: the .hea header names the
    # record internally (first line), and wfdb resolves the .dat from that
    # name — renaming the pair would break the header/.dat link.
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    upload_dir = UPLOAD_DIR / timestamp
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: List[Path] = []
    for f in files:
        # Path(...).name strips any directory components (path traversal)
        safe_filename = Path(f.filename).name  # type: ignore[arg-type]
        path = upload_dir / safe_filename
        with open(path, "wb") as buffer:
            shutil.copyfileobj(f.file, buffer)
        saved_paths.append(path)

    # WFDB pair → analyze via the .dat; otherwise the single file
    dat_path = next((p for p in saved_paths if p.suffix == ".dat"), saved_paths[0])
    original_name = next(
        (f.filename for f in files if _ext(f.filename) == "dat"),
        files[0].filename or "",
    )

    # Run analysis (mock or real depending on config)
    try:
        analysis_result = analyze_ecg(str(dat_path), original_filename=original_name)
    except ValueError as e:
        # Unreadable file / wrong lead count / bad format
        for p in saved_paths:
            p.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(e))
    except FileNotFoundError as e:
        # e.g. .dat uploaded without its .hea, or the .hea header references
        # a record name that doesn't match the uploaded .dat filename
        for p in saved_paths:
            p.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail="Could not read the WFDB record. Make sure the .dat and "
                   ".hea share the same base name as the record name inside "
                   f"the .hea header (looking for: {e.filename or 'unknown'}).",
        )
    except ImportError as e:
        for p in saved_paths:
            p.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e))

    # Store results in database
    db_result = ECGResult(
        patient_id=analysis_result.get("patient_id", "unknown"),
        filename=dat_path.name,
        file_path=str(dat_path),
        flags=analysis_result["flags"],
        confidence_scores=analysis_result["confidence_scores"],
        overall_prediction=analysis_result["overall_prediction"],
        raw_signal_summary=analysis_result.get("raw_signal_summary", ""),
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)

    return ECGUploadResponse(
        id=db_result.id,
        filename=dat_path.name,
        patient_id=db_result.patient_id,
        status="analyzed",
        created_at=db_result.created_at,
    )


@router.get("/results", response_model=List[ECGResultResponse])
async def get_results(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    """Retrieve all ECG analysis results."""
    results = db.query(ECGResult).offset(skip).limit(limit).all()
    return [
        ECGResultResponse(
            id=r.id,
            patient_id=r.patient_id,
            filename=r.filename,
            flags=r.flags,
            confidence_scores=r.confidence_scores,
            overall_prediction=r.overall_prediction,
            created_at=r.created_at,
        )
        for r in results
    ]


@router.get("/results/{result_id}", response_model=ECGResultResponse)
async def get_result(result_id: int, db: Session = Depends(get_db)):
    """Retrieve a specific ECG analysis result by ID."""
    result = db.query(ECGResult).filter(ECGResult.id == result_id).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")

    return ECGResultResponse(
        id=result.id,
        patient_id=result.patient_id,
        filename=result.filename,
        flags=result.flags,
        confidence_scores=result.confidence_scores,
        overall_prediction=result.overall_prediction,
        created_at=result.created_at,
    )


@router.get("/results/{result_id}/report")
async def get_ai_report(result_id: int, db: Session = Depends(get_db)):
    """
    Generate an AI clinical summary report for an ECG analysis result.

    Uses an LLM (OpenAI-compatible API) when AI_API_KEY is configured;
    otherwise falls back to a rule-based template so the endpoint always
    returns a usable report.
    """
    result = db.query(ECGResult).filter(ECGResult.id == result_id).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")

    return await generate_ai_report(result)


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": settings.app_name,
        "mock_inference": settings.mock_inference,
    }
