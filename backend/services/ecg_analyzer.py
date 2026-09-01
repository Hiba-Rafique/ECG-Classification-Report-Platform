"""
ECG Analyzer — orchestrates preprocessing and inference.

When MOCK_INFERENCE=true in config, returns mock results.
When MOCK_INFERENCE=false, loads the trained CNN model and runs real inference:
upload → load file → shared preprocessing → CNN → flags + confidence.

The preprocessing module (ml/preprocessing.py) is the SAME one used during
training on Kaggle — do not modify one without the other.
"""

from typing import Dict, Any

from backend.config import settings
from backend.services.mock_inference import mock_inference, _extract_patient_id


# The model was trained on 12-lead PTB-XL records — reject other lead counts
# early with a clear message rather than letting the CNN crash.
REQUIRED_LEADS = 12


def analyze_ecg(file_path: str, original_filename: str = "") -> Dict[str, Any]:
    """
    Analyze an uploaded ECG file.

    In mock mode: returns randomized flags (for UI development).
    In real mode: runs preprocessing → CNN inference → returns flags + confidence.

    Args:
        file_path: on-disk path (timestamped safe filename).
        original_filename: user's original filename — used for patient ID
            extraction since file_path is prefixed with an upload timestamp.
    """
    if settings.mock_inference:
        return mock_inference(original_filename or file_path)

    # ── Real inference path ──────────────────────────────────────
    from ml.preprocessing import load_ecg_file, preprocess_ecg
    from ml.inference import run_inference

    # 1. Load the raw signal (CSV / WFDB / EDF)
    signal, fs = load_ecg_file(file_path)

    # 2. Validate lead count before touching the model
    if signal.ndim != 2 or signal.shape[1] != REQUIRED_LEADS:
        actual = signal.shape[1] if signal.ndim == 2 else 1
        raise ValueError(
            f"Expected {REQUIRED_LEADS}-lead ECG, got {actual} lead(s). "
            f"The model was trained on 12-lead recordings only."
        )

    # 3. Shared preprocessing pipeline (identical to training)
    preprocessed = preprocess_ecg(signal, fs)  # (segments, 5000, 12)

    # 4. CNN inference — engine loads weights once, then reuses
    result = run_inference(preprocessed)

    # 5. Attach patient ID derived from the original filename (no PHI in ECG files)
    result["patient_id"] = _extract_patient_id(original_filename or file_path)
    return result
