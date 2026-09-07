from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from datetime import datetime


class FlaggedRegionSchema(BaseModel):
    """A single flagged region in the ECG signal."""
    region_type: str          # e.g. "ST_elevation", "QRS_abnormal", "T_wave_inversion"
    start_sample: int
    end_sample: int
    confidence: float         # 0.0 to 1.0
    description: str


class ECGUploadResponse(BaseModel):
    """Response returned after a successful upload and analysis."""
    id: int
    filename: str
    patient_id: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ECGResultResponse(BaseModel):
    """Full analysis result returned to the frontend."""
    id: int
    patient_id: str
    filename: str
    flags: List[str]
    confidence_scores: List[float]
    overall_prediction: str
    created_at: datetime

    class Config:
        from_attributes = True


class ECGSignalResponse(BaseModel):
    """Raw signal payload for the 12-lead viewer."""
    fs: int                    # original recording sampling rate (Hz)
    signal_fs: float           # sampling rate of the samples in this payload
    duration_s: float          # seconds of signal included
    units: str                 # "mV"
    lead_names: List[str]      # 12 canonical lead names, file order
    leads: List[List[float]]   # one sample array per lead


class ECGReportResponse(BaseModel):
    """Full clinical report (the notebook's 5-stage pipeline output).

    `case` is the structured Stage 3 object (the narrative's only input):
    recording info, ecg measurements (None = unavailable), findings,
    diagnosis, class_probabilities and thresholds per superclass.
    `narrative` holds the five Stage 4 sections.
    """
    result_id: int
    generated_at: datetime
    generated_by: str                       # "ai" | "template"
    guardrail: Dict[str, Any]               # {"violations": [...]}
    case: Dict[str, Any]
    narrative: Dict[str, str]
    disclaimer: str
