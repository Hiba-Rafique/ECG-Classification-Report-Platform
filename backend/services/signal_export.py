"""
Signal export — serves the stored ECG recording to the frontend viewer.

Loads the ORIGINAL uploaded file through the shared loaders in
ml/preprocessing.py (WFDB via the wfdb library, CSV via pandas, EDF via
pyedflib), applies the same 0.5–45 Hz bandpass the classifier sees, keeps
the first 10 seconds, and decimates to ~250 Hz so the JSON payload stays
light while the trace stays visually faithful at 25 mm/s paper speed.
"""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import numpy as np

from backend.models.ecg_result import ECGResult

logger = logging.getLogger(__name__)

DISPLAY_FS = 250   # transport sampling rate for the viewer payload
MAX_SECONDS = 10   # the viewer shows one 10-second segment
MV_DECIMALS = 3    # microvolt resolution keeps the JSON compact


@lru_cache(maxsize=16)
def _prepare_payload(file_path: str, mtime: float) -> Dict[str, Any]:
    """
    Build the viewer payload for a recording on disk.

    Cached on (path, mtime) — the upload files are immutable, so each
    result's signal is loaded and decimated at most once per server run.
    """
    from ml.preprocessing import (
        DEFAULT_LEAD_NAMES,
        bandpass_filter,
        load_ecg_file_with_meta,
    )

    signal, fs, lead_names = load_ecg_file_with_meta(file_path)
    signal = np.nan_to_num(np.asarray(signal, dtype=np.float64))

    if signal.ndim != 2:
        signal = signal.reshape(-1, 1)

    if len(lead_names) != signal.shape[1]:
        lead_names = list(DEFAULT_LEAD_NAMES)[: signal.shape[1]]

    # First 10 seconds only (one model segment)
    signal = signal[: int(fs * MAX_SECONDS)]

    # Same bandpass the model input goes through — the viewer shows the
    # signal exactly as it was analyzed, and it removes baseline wander.
    try:
        signal = bandpass_filter(signal, fs)
    except Exception as e:  # ultra-short recordings can fail filtfilt
        logger.debug("Display bandpass skipped for %s: %s", file_path, e)

    # Decimate to ~DISPLAY_FS with block means (cheap anti-aliasing)
    factor = max(1, int(round(fs / DISPLAY_FS)))
    if factor > 1:
        n = (len(signal) // factor) * factor
        signal = signal[:n].reshape(-1, factor, signal.shape[1]).mean(axis=1)
    signal_fs = fs / factor

    duration_s = len(signal) / signal_fs

    # (samples, leads) -> per-lead sample arrays, rounded to microvolts
    leads = [
        [round(float(v), MV_DECIMALS) for v in lead]
        for lead in signal.T
    ]

    return {
        "fs": int(round(fs)),
        "signal_fs": signal_fs,
        "duration_s": round(duration_s, 3),
        "units": "mV",
        "lead_names": lead_names,
        "leads": leads,
    }


def export_signal(result: ECGResult) -> Dict[str, Any]:
    """Build the viewer payload for a stored result's recording."""
    path = Path(result.file_path)
    if not path.is_file():
        raise FileNotFoundError(
            f"Stored recording not found: {result.file_path}"
        )
    return _prepare_payload(str(path), path.stat().st_mtime)
