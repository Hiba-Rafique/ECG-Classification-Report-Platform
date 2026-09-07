"""
Stage 2 — Signal measurement extraction.

Ported from training/ecg-train.ipynb (Stage 2), which was validated against
synthetic P-QRS-T morphologies and PTB-XL's own annotations. Every number
here is computed from the waveform — the narrative layer never gets to
invent one. Anything that cannot be measured is reported as None
(unavailable); nothing is ever filled in.

Measurements:
    HR          R-peak detection on lead II (QRS-energy envelope + adaptive
                threshold) → median RR
    PR/QRS/QT/QTc  Onset/offset detection on the median beat template;
                Bazett correction for QTc
    P/QRS/T axis   Net deflection area of the median beat in leads I & aVF
                (hexaxial geometry)

Signal contract: `sig` is (samples, 12) in TRUE mV (bandpass-filtered but
NOT per-lead normalized — z-scoring distorts net deflection areas).
Timing intervals are amplitude-independent and would also work on the
z-scored cache, but we always pass filtered mV here so axes are valid too.

Delineation notes (hard-won):
- Amplitude walks require SUSTAINED band-entry (~30 ms runs): brief
  cancellation dips (Q wave cancelling the R tail) otherwise truncate QRS.
- P waves are 10–20% of R amplitude, so they get their own gentler noise
  band (0.5×); the QRS walks use a tighter band (noise/3) because the
  median template suppresses beat-to-beat noise.
"""

import math
from typing import Any, Dict, Optional

import numpy as np
from scipy.signal import find_peaks

# PTB-XL lead order: I II III aVR aVL aVF V1..V6
LEAD_II, LEAD_I, LEAD_AVF = 1, 0, 5


def detect_r_peaks(sig: np.ndarray, fs: int = 500) -> np.ndarray:
    """R-peak candidates on one lead: QRS-energy envelope + adaptive threshold."""
    deriv = np.abs(np.gradient(sig))
    win = max(1, int(0.08 * fs))
    env = np.convolve(deriv, np.ones(win) / win, mode="same")
    if env.std() < 1e-9:
        return np.array([], dtype=int)
    peaks, _ = find_peaks(env, height=env.mean() + 2.0 * env.std(),
                          distance=int(0.25 * fs))
    half, out = int(0.08 * fs), []
    for p in peaks:
        lo, hi = max(0, p - half), min(len(sig), p + half)
        out.append(lo + int(np.argmax(sig[lo:hi])))
    return np.array(sorted(set(out)), dtype=int)


def median_beat(sig: np.ndarray, r_peaks: np.ndarray, fs: int = 500):
    """Median-aligned beat template on one lead. Returns (template, r_index) or (None, None)."""
    pre, post = int(0.30 * fs), int(0.45 * fs)
    beats = [sig[p - pre: p + post] for p in r_peaks
             if p - pre >= 0 and p + post <= len(sig)]
    if len(beats) < 3:
        return None, None
    return np.median(np.stack(beats), axis=0), pre


def _q_onset(tmpl: np.ndarray, r_idx: int, baseline: float, noise: float, fs: int) -> Optional[int]:
    """Walk backwards from R; onset = SUSTAINED (>=30 ms) entry into the noise band.

    Brief cancellation dips (Q wave cancelling the R tail) are skipped over.
    """
    sustain = int(0.03 * fs)
    i = r_idx - 2
    stop = max(1, r_idx - int(0.12 * fs))
    while i > stop:
        if abs(tmpl[i] - baseline) <= noise:
            j = max(0, i - sustain)
            if np.all(np.abs(tmpl[j:i] - baseline) <= noise):
                return i
        i -= 1
    return None


def _qrs_offset(tmpl: np.ndarray, r_idx: int, baseline: float, noise: float, fs: int) -> Optional[int]:
    """Walk forward from R; offset = SUSTAINED entry into the noise band.

    None if it never settles within 140 ms (e.g. marked ST deviation) —
    QRS then stays unavailable rather than wrong.
    """
    sustain = int(0.03 * fs)
    i = r_idx + 2
    stop = min(len(tmpl) - 1, r_idx + int(0.14 * fs))
    while i < stop:
        if abs(tmpl[i] - baseline) <= noise:
            seg = np.abs(tmpl[i: i + sustain] - baseline)
            if len(seg) == sustain and np.all(seg <= noise):
                return i
        i += 1
    return None


def _t_offset(tmpl: np.ndarray, q_off: int, baseline: float, noise: float, fs: int) -> Optional[int]:
    """T-wave offset: first sustained (>=60 ms) return to baseline AFTER the T peak."""
    lo = q_off + int(0.05 * fs)
    hi = min(len(tmpl) - 1, q_off + int(0.48 * fs))
    if hi <= lo:
        return None
    dev = np.abs(tmpl[lo:hi] - baseline)
    t_peak = lo + int(np.argmax(dev))
    if dev[t_peak - lo] <= noise:
        return None  # no discernible T wave -> QT unavailable
    sustain = int(0.06 * fs)
    i = t_peak
    while i < hi:
        if abs(tmpl[i] - baseline) <= noise:
            seg = np.abs(tmpl[i: i + sustain] - baseline)
            if len(seg) == sustain and np.all(seg <= noise):
                return i
        i += 1
    return None  # T wave never settles back within the window


def _p_onset(tmpl: np.ndarray, q_on: int, baseline: float, noise: float, fs: int) -> Optional[int]:
    """P-wave onset before QRS; None when no discernible P (e.g. atrial fibrillation).

    P waves are much smaller than R, so they get their own gentler noise band.
    """
    p_noise = noise * 0.5
    hi = q_on - int(0.02 * fs)
    lo = max(1, q_on - int(0.22 * fs))
    if hi <= lo:
        return None
    dev = np.abs(tmpl[lo:hi] - baseline)
    p_peak = lo + int(np.argmax(dev))
    if dev[p_peak - lo] <= p_noise:
        return None
    sustain = int(0.04 * fs)
    i = p_peak
    while i > lo:
        if abs(tmpl[i] - baseline) <= p_noise:
            j = max(0, i - sustain)
            if np.all(np.abs(tmpl[j:i] - baseline) <= p_noise):
                return i
        i -= 1
    return None


def _axis_category(net_i: float, net_avf: float) -> Optional[str]:
    """Hexaxial axis from net deflection areas in leads I and aVF."""
    if abs(net_i) < 1e-9 and abs(net_avf) < 1e-9:
        return None
    deg = math.degrees(math.atan2(net_avf, net_i))
    if -30 <= deg <= 90:
        return f"normal axis ({deg:.0f} deg)"
    if deg > 90:
        return f"right axis deviation ({deg:.0f} deg)"
    if deg < -90:
        return f"extreme axis ({deg:.0f} deg)"
    return f"left axis deviation ({deg:.0f} deg)"


def measure_ecg(sig: np.ndarray, fs: int = 500) -> Dict[str, Any]:
    """Stage 2 for one recording. `sig` is (samples, 12) in mV.

    Unmeasurable quantities stay None — they are never filled in.
    """
    out: Dict[str, Any] = {
        "heart_rate": None, "rhythm": None,
        "pr": None, "qrs": None, "qt": None, "qtc": None,
        "qrs_axis": None, "p_axis": None, "t_axis": None,
    }
    try:
        if sig.ndim != 2 or sig.shape[1] < 6:
            return out
        r_peaks = detect_r_peaks(sig[:, LEAD_II], fs)
        if len(r_peaks) < 3:
            return out
        rr = np.diff(r_peaks) / fs
        rr = rr[(rr > 0.33) & (rr < 2.5)]
        if len(rr) == 0:
            return out
        out["heart_rate"] = int(round(60.0 / float(np.median(rr))))

        # Rhythm: infer from P-wave presence + RR regularity.
        # Sinus when PR is measurable (discernible P before each QRS) and
        # RR is regular; irregular RR or absent P -> "irregular rhythm".
        # (PTB-XL's scp annotations are unavailable for user uploads, so
        # rhythm is derived from the waveform — the same way a clinician
        # reads a rhythm strip.)
        tmpl, r_idx = median_beat(sig[:, LEAD_II], r_peaks, fs)
        if tmpl is None:
            return out
        baseline = float(np.median(tmpl[: int(0.06 * fs)]))
        noise = 0.15 * float(np.max(np.abs(tmpl - baseline)))
        qrs_noise = noise / 3.0  # the median template suppresses beat noise

        q_on = _q_onset(tmpl, r_idx, baseline, qrs_noise, fs)
        q_off = _qrs_offset(tmpl, r_idx, baseline, qrs_noise, fs)
        p_on = t_off = None
        if q_on is not None and q_off is not None:
            out["qrs"] = int(round((q_off - q_on) / fs * 1000))
            p_on = _p_onset(tmpl, q_on, baseline, noise, fs)
            if p_on is not None:
                out["pr"] = int(round((q_on - p_on) / fs * 1000))
            t_off = _t_offset(tmpl, q_off, baseline, noise, fs)
            if t_off is not None:
                qt_ms = (t_off - q_on) / fs * 1000
                out["qt"] = int(round(qt_ms))
                out["qtc"] = int(round(qt_ms / math.sqrt(float(np.median(rr)))))

        # Rhythm: P present + regular RR -> sinus; else irregular
        rr_cv = float(np.std(rr) / np.mean(rr)) if len(rr) > 1 else 0.0
        if p_on is not None and rr_cv < 0.12:
            out["rhythm"] = "sinus rhythm"
        elif rr_cv >= 0.12:
            out["rhythm"] = "irregular rhythm"
        else:
            out["rhythm"] = "rhythm with absent P waves"

        # Axes: net deflection areas over the QRS window in leads I & aVF.
        if q_on is not None and q_off is not None:
            tmpl_i, _ = median_beat(sig[:, LEAD_I], r_peaks, fs)
            tmpl_f, _ = median_beat(sig[:, LEAD_AVF], r_peaks, fs)
            if tmpl_i is not None and tmpl_f is not None:
                net_i = float(np.sum(tmpl_i[q_on:q_off]))
                net_f = float(np.sum(tmpl_f[q_on:q_off]))
                out["qrs_axis"] = _axis_category(net_i, net_f)
                if p_on is not None:
                    plo, phi = max(0, q_on - int(0.18 * fs)), q_on - int(0.03 * fs)
                    out["p_axis"] = _axis_category(
                        float(np.sum(tmpl_i[plo:phi])),
                        float(np.sum(tmpl_f[plo:phi])))
                if t_off is not None:
                    tlo, thi = q_off + int(0.05 * fs), t_off
                    out["t_axis"] = _axis_category(
                        float(np.sum(tmpl_i[tlo:thi])),
                        float(np.sum(tmpl_f[tlo:thi])))
    except Exception:  # noqa: BLE001 — measurement failure must never break the pipeline
        pass  # -> stays None (unavailable, never invented)
    return out
