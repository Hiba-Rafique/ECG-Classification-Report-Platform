"""
ECG Preprocessing Pipeline.

SHARED MODULE — used by both training and inference.
Any changes here affect both paths. Do not duplicate this logic.

Steps:
1. Load raw ECG data (WFDB, CSV, EDF)
2. Bandpass filter (0.5–45 Hz) to remove baseline wander and high-frequency noise
3. Resample to a uniform sampling rate (500 Hz)
4. Segment into fixed-length windows
5. Normalize (z-score per lead)
"""

import numpy as np
from scipy.signal import butter, filtfilt, resample
from typing import Tuple, Optional, Dict, Any


# ── Constants ──────────────────────────────────────────────────────────
TARGET_FS = 500           # Target sampling rate in Hz
BANDPASS_LOW = 0.5        # Bandpass lower cutoff (Hz)
BANDPASS_HIGH = 45.0      # Bandpass upper cutoff (Hz)
SEGMENT_LENGTH_SEC = 10   # Length of each segment in seconds
NUM_LEADS = 12            # Expected number of leads for PTB-XL


def preprocess_ecg(
    signal: np.ndarray,
    fs: int,
    num_leads: int = NUM_LEADS,
) -> np.ndarray:
    """
    Full preprocessing pipeline: filter → resample → segment → normalize.

    Args:
        signal: Raw ECG signal, shape (num_samples, num_leads) or (num_samples,)
        fs: Original sampling rate in Hz
        num_leads: Expected number of leads

    Returns:
        Preprocessed signal, shape (num_segments, segment_samples, num_leads)
    """
    # Ensure 2D
    if signal.ndim == 1:
        signal = signal.reshape(-1, 1)

    # Step 1: Bandpass filter
    filtered = bandpass_filter(signal, fs, low=BANDPASS_LOW, high=BANDPASS_HIGH)

    # Step 2: Resample to target frequency
    if fs != TARGET_FS:
        filtered = resample_signal(filtered, fs, TARGET_FS)
    else:
        pass  # already at target rate

    # Step 3: Segment
    segments = segment_signal(filtered, TARGET_FS, SEGMENT_LENGTH_SEC)

    # Step 4: Normalize (z-score per lead)
    segments = normalize_segments(segments)

    return segments


# ── Individual steps ───────────────────────────────────────────────────

def bandpass_filter(
    signal: np.ndarray,
    fs: int,
    low: float = BANDPASS_LOW,
    high: float = BANDPASS_HIGH,
    order: int = 4,
) -> np.ndarray:
    """Apply a Butterworth bandpass filter to each lead."""
    nyq = 0.5 * fs
    b, a = butter(order, [low / nyq, high / nyq], btype="band")
    filtered = np.apply_along_axis(
        lambda x: filtfilt(b, a, x), axis=0, arr=signal
    )
    return filtered


def resample_signal(signal: np.ndarray, fs_orig: int, fs_target: int) -> np.ndarray:
    """Resample signal to target sampling rate."""
    num_samples_target = int(len(signal) * fs_target / fs_orig)
    resampled = resample(signal, num_samples_target, axis=0)
    return resampled


def segment_signal(
    signal: np.ndarray,
    fs: int,
    segment_length_sec: int = SEGMENT_LENGTH_SEC,
) -> np.ndarray:
    """
    Split signal into fixed-length, non-overlapping segments.
    Discards any trailing samples that don't fill a complete segment.

    Returns: shape (num_segments, segment_samples, num_leads)
    """
    segment_samples = fs * segment_length_sec
    num_samples = len(signal)
    num_segments = num_samples // segment_samples

    if num_segments == 0:
        # Signal shorter than one segment — zero-pad
        padded = np.zeros((segment_samples, signal.shape[1]))
        padded[:num_samples] = signal
        return padded.reshape(1, segment_samples, signal.shape[1])

    # Trim to exact multiple of segment length
    trimmed = signal[: num_segments * segment_samples]
    segments = trimmed.reshape(num_segments, segment_samples, signal.shape[1])
    return segments


def normalize_segments(segments: np.ndarray) -> np.ndarray:
    """
    Z-score normalize each segment per lead.
    segments shape: (num_segments, segment_samples, num_leads)
    """
    mean = segments.mean(axis=1, keepdims=True)
    std = segments.std(axis=1, keepdims=True)
    std = np.where(std == 0, 1.0, std)  # avoid division by zero
    return (segments - mean) / std


# ── File loaders ───────────────────────────────────────────────────────

def load_ecg_file(file_path: str) -> Tuple[np.ndarray, int]:
    """
    Load an ECG file and return (signal, sampling_rate).
    Supports CSV, WFDB (.dat/.hea), and EDF formats.
    """
    from pathlib import Path

    ext = Path(file_path).suffix.lower()

    if ext == ".csv":
        return _load_csv(file_path)
    elif ext in (".dat", ".hea"):
        return _load_wfdb(file_path)
    elif ext == ".edf":
        return _load_edf(file_path)
    else:
        raise ValueError(f"Unsupported file format: {ext}")


def _load_csv(file_path: str) -> Tuple[np.ndarray, int]:
    """Load ECG from CSV. Assumes columns are leads, rows are samples."""
    import pandas as pd
    df = pd.read_csv(file_path)
    signal = df.values.astype(np.float64)
    # Try to infer sampling rate from metadata, default to 500 Hz
    fs = 500
    return signal, fs


def _load_wfdb(file_path: str) -> Tuple[np.ndarray, int]:
    """Load ECG from WFDB format."""
    import wfdb
    # Strip extension to get the record name
    from pathlib import Path
    record_path = str(Path(file_path).with_suffix(""))
    record = wfdb.rdrecord(record_path)
    return record.p_signal, record.fs


def _load_edf(file_path: str) -> Tuple[np.ndarray, int]:
    """Load ECG from EDF format."""
    try:
        import pyedflib
    except ImportError:
        raise ImportError("pyedflib is required to read EDF files. Install with: pip install pyedflib")

    f = pyedflib.EdfReader(file_path)
    signals = []
    for i in range(f.signals_in_file):
        signals.append(f.readSignal(i))
    fs = int(f.samplefrequency(0))
    f.close()

    signal = np.column_stack(signals)
    return signal, fs
