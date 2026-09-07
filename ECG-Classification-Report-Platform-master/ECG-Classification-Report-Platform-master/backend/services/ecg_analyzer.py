from typing import Dict, Any
from backend.config import settings
from backend.services.mock_inference import mock_inference, _extract_patient_id
from backend.services.measurements import measure_ecg
from ml.preprocessing import TARGET_FS, bandpass_filter, resample_signal, load_ecg_file, preprocess_ecg
from ml.inference import run_inference

REQUIRED_LEADS = 12

def analyze_ecg(file_path: str, original_filename: str = "") -> Dict[str, Any]:
    """
    Analyze an uploaded ECG file, combining CNN inference with real signal measurements.
    """
    if settings.mock_inference:
        return mock_inference(original_filename or file_path)

    # 1. Load the raw signal (CSV / WFDB / EDF)
    signal, fs = load_ecg_file(file_path)

    # 2. Validate lead count before touching the model
    if signal.ndim != 2 or signal.shape[1] != REQUIRED_LEADS:
        actual = signal.shape[1] if signal.ndim == 2 else 1
        raise ValueError(
            f"Expected {REQUIRED_LEADS}-lead ECG, got {actual} lead(s). "
            f"The model was trained on 12-lead recordings only."
        )

    # 3. Shared preprocessing pipeline for the CNN
    preprocessed = preprocess_ecg(signal, fs)  # (segments, 5000, 12)

    # 4. CNN inference — engine loads weights once, then reuses
    inference = run_inference(preprocessed)

    # 5. Extract clinical waveform measurements (PR, QRS, QT/QTc, axes)
    filtered = bandpass_filter(signal, fs)
    if fs != TARGET_FS:
        filtered = resample_signal(filtered, fs, TARGET_FS)
    window = filtered[: TARGET_FS * 10]
    measurements = measure_ecg(window, fs=TARGET_FS)

    # 6. Merge measurements and patient metadata into the result object
    inference["measurements"] = measurements
    inference["patient_id"] = _extract_patient_id(original_filename or file_path)
    
    return inference