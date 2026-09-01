from pydantic import BaseModel
from typing import List, Optional
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
