from sqlalchemy import Column, Integer, String, Float, DateTime, Text, JSON
from sqlalchemy.sql import func

from backend.database import Base


class ECGResult(Base):
    """Stores the result of an ECG analysis."""

    __tablename__ = "ecg_results"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String(100), index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)

    # Analysis results
    flags = Column(JSON, nullable=False)              # List of flagged abnormality types
    confidence_scores = Column(JSON, nullable=False)   # Confidence per flag
    overall_prediction = Column(String(50), nullable=False)  # "normal" or "abnormal"
    raw_signal_summary = Column(Text, nullable=True)   # Optional signal metadata

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<ECGResult(id={self.id}, patient={self.patient_id}, prediction={self.overall_prediction})>"
