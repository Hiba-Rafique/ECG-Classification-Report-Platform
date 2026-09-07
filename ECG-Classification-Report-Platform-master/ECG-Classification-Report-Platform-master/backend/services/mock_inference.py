"""
Mock inference module.
Returns hardcoded flag output so frontend/integration work can proceed
while the real CNN model is being trained.
"""

import random
from typing import Dict, Any, List


# Possible abnormality types the mock can flag
MOCK_ABNORMALITY_TYPES = [
    "ST_elevation",
    "ST_depression",
    "T_wave_inversion",
    "QRS_widening",
    "QT_prolongation",
    "atrial_fibrillation",
    "premature_ventricular_contraction",
    "left_bundle_branch_block",
    "right_bundle_branch_block",
    "left_ventricular_hypertrophy",
]


def mock_inference(file_path: str) -> Dict[str, Any]:
    """
    Return a realistic-looking but fake analysis result.
    Used as a stand-in until the real trained model is available.
    """
    # Randomly decide normal vs abnormal (40% chance abnormal)
    is_abnormal = random.random() < 0.4

    if not is_abnormal:
        return {
            "patient_id": _extract_patient_id(file_path),
            "overall_prediction": "normal",
            "flags": [],
            "confidence_scores": [],
            "raw_signal_summary": "12-lead ECG, 500 Hz, 10 seconds",
        }

    # Pick 1-3 random abnormalities
    num_flags = random.randint(1, 3)
    selected = random.sample(MOCK_ABNORMALITY_TYPES, num_flags)
    confidences = [round(random.uniform(0.55, 0.95), 3) for _ in selected]

    return {
        "patient_id": _extract_patient_id(file_path),
        "overall_prediction": "abnormal",
        "flags": selected,
        "confidence_scores": confidences,
        "raw_signal_summary": "12-lead ECG, 500 Hz, 10 seconds",
    }


def _extract_patient_id(file_path: str) -> str:
    """Try to extract a patient ID from the filename, otherwise return 'mock_patient'."""
    from pathlib import Path
    name = Path(file_path).stem
    # If the filename has a pattern like "patient_001_data.csv", extract the ID part
    parts = name.split("_")
    if len(parts) >= 3:
        return f"patient_{parts[1]}" if parts[1].isdigit() else "mock_patient"
    return "mock_patient"
