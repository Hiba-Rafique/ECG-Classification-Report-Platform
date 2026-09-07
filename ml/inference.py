"""
Inference module — multi-label SE-ResNet prediction on preprocessed ECG.

The engine loads models/weights/resnet1d_multilabel_best.pth (trained in
training/ecg-train.ipynb, Stage 1) once and reuses it across requests.

Multi-label semantics (different from the old single-label CNN):
- The model emits 5 INDEPENDENT logits (NORM, MI, STTC, CD, HYP); sigmoid,
  not softmax — a record can carry several superclasses at once.
- Per-class decision thresholds were tuned on the PTB-XL validation fold
  (maximize per-class F1) and shipped in models/weights/thresholds.json.
  A missing/fallback file degrades to 0.5 for every class.
- Segments of longer recordings are scored independently and averaged —
  the same aggregation the notebook used for its test-fold evaluation.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict

import numpy as np
import torch

from ml.models.resnet import ResNet1D

logger = logging.getLogger(__name__)

# Superclass order — must match the training column order in ecg-train.ipynb
SUPERCLASSES = ["NORM", "MI", "STTC", "CD", "HYP"]

# Human-readable phrasing for reports / UI
SUPERCLASS_READABLE = {
    "NORM": "Normal ECG",
    "MI": "Myocardial infarction",
    "STTC": "ST/T-segment change",
    "CD": "Conduction disturbance",
    "HYP": "Hypertrophy",
}

# Threshold fallback when thresholds.json is absent
DEFAULT_THRESHOLD = 0.5

_WEIGHTS_DIR = Path(__file__).resolve().parents[1] / "models" / "weights"


def _load_thresholds() -> Dict[str, float]:
    """Validation-tuned per-class thresholds, or defaults when missing."""
    path = _WEIGHTS_DIR / "thresholds.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        out = {s: float(data.get(s, DEFAULT_THRESHOLD)) for s in SUPERCLASSES}
        logger.info("Loaded decision thresholds from %s", path)
        return out
    except FileNotFoundError:
        logger.warning("thresholds.json not found (%s) — using %.2f for all classes",
                       path, DEFAULT_THRESHOLD)
        return {s: DEFAULT_THRESHOLD for s in SUPERCLASSES}
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("thresholds.json unreadable (%s) — using %.2f defaults", e, DEFAULT_THRESHOLD)
        return {s: DEFAULT_THRESHOLD for s in SUPERCLASSES}


class InferenceEngine:
    """Loads the multi-label SE-ResNet once and scores preprocessed signals."""

    def __init__(self, model_path: str, device: str = "cpu"):
        self.device = torch.device(device)
        self.thresholds = _load_thresholds()
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str) -> ResNet1D:
        model = ResNet1D(
            num_leads=12,
            num_classes=len(SUPERCLASSES),
        )
        # Plain state_dict produced by our own training (torch.save of
        # model.state_dict()); weights_only=True forbids arbitrary pickle
        # objects, so a tampered file cannot execute code on load.
        state_dict = torch.load(model_path, map_location=self.device, weights_only=True)
        model.load_state_dict(state_dict)
        model.to(self.device)
        model.eval()
        logger.info("Loaded multi-label SE-ResNet weights from %s", model_path)
        return model

    @torch.no_grad()
    def predict(self, preprocessed_signal: np.ndarray) -> Dict[str, Any]:
        """
        Score a preprocessed ECG recording.

        Args:
            preprocessed_signal: shape (num_segments, 5000, 12) — the shared
                preprocessing pipeline output.

        Returns:
            Dict with:
                overall_prediction — "normal" when NO class crosses its
                    threshold, else "abnormal" (multi-label has no argmax)
                flags               — superclasses above their threshold,
                                        highest probability first
                confidence_scores   — the probabilities of those flags (same order)
                class_probabilities — {superclass: probability} for ALL classes
                thresholds          — the decision thresholds used
        """
        # (segments, 5000, 12) → (segments, 12, 5000)
        tensor = torch.from_numpy(preprocessed_signal).float().permute(0, 2, 1)
        tensor = tensor.to(self.device)

        logits = self.model(tensor)                 # (segments, 5)
        probs = torch.sigmoid(logits)               # independent sigmoids
        avg_probs = probs.mean(dim=0).cpu().numpy()  # (5,) averaged over segments

        flagged = [
            (s, float(avg_probs[i]))
            for i, s in enumerate(SUPERCLASSES)
            if avg_probs[i] >= self.thresholds[s]
        ]
        # Strongest signal first for report ordering
        flagged.sort(key=lambda kv: kv[1], reverse=True)

        return {
            "overall_prediction": "abnormal" if flagged else "normal",
            "flags": [s for s, _ in flagged],
            "confidence_scores": [round(p, 4) for _, p in flagged],
            "class_probabilities": {s: round(float(avg_probs[i]), 4)
                                    for i, s in enumerate(SUPERCLASSES)},
            "thresholds": dict(self.thresholds),
            "raw_signal_summary": f"{preprocessed_signal.shape[0]} segment(s) analyzed",
        }


# Singleton-like accessor — the 27 MB model loads once per process
_engine: InferenceEngine = None  # type: ignore


def get_inference_engine(model_path: str, device: str = "cpu") -> InferenceEngine:
    """Get or create the inference engine (loaded once, reused)."""
    global _engine
    if _engine is None:
        _engine = InferenceEngine(model_path, device)
    return _engine


def run_inference(preprocessed_signal: np.ndarray) -> Dict[str, Any]:
    """Convenience function for the backend to call."""
    from backend.config import settings
    engine = get_inference_engine(settings.model_path)
    return engine.predict(preprocessed_signal)
