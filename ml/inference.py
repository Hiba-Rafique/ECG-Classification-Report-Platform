"""
Inference module — loads trained model and runs prediction on preprocessed ECG.

This is the interface that the backend calls during real inference (Day 3/4).
"""

import torch
import numpy as np
from typing import Dict, Any, List

from ml.models.cnn_model import ECGClassifier


# Label mapping — must match what was used during training
CLASS_LABELS = [
    "normal",
    "myocardial_infarction",
    "conduction_defect",
    "hypertrophy",
    "st_t_abnormality",
]


class InferenceEngine:
    """Loads a trained model once and runs inference on preprocessed signals."""

    def __init__(self, model_path: str, device: str = "cpu"):
        self.device = torch.device(device)
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str) -> ECGClassifier:
        model = ECGClassifier(
            num_leads=12,
            num_classes=len(CLASS_LABELS),
        )
        state_dict = torch.load(model_path, map_location=self.device)
        model.load_state_dict(state_dict)
        model.to(self.device)
        model.eval()
        return model

    @torch.no_grad()
    def predict(self, preprocessed_signal: np.ndarray) -> Dict[str, Any]:
        """
        Run inference on a preprocessed ECG signal.

        Args:
            preprocessed_signal: shape (num_segments, segment_samples, num_leads)

        Returns:
            Dict with overall_prediction, flags, and confidence_scores.
        """
        # Convert to tensor: (batch=num_segments, leads, samples)
        tensor = torch.from_numpy(preprocessed_signal).float()
        tensor = tensor.permute(0, 2, 1)  # (segments, leads, samples)
        tensor = tensor.to(self.device)

        logits = self.model(tensor)              # (segments, num_classes)
        probs = torch.softmax(logits, dim=1)     # (segments, num_classes)

        # Average predictions across segments
        avg_probs = probs.mean(dim=0).cpu().numpy()  # (num_classes,)
        pred_idx = int(np.argmax(avg_probs))

        # Build result
        predicted_label = CLASS_LABELS[pred_idx]
        flags = []
        confidences = []

        for i, label in enumerate(CLASS_LABELS):
            if label != "normal" and avg_probs[i] > 0.15:
                flags.append(label)
                confidences.append(round(float(avg_probs[i]), 3))

        return {
            "overall_prediction": "normal" if pred_idx == 0 else "abnormal",
            "flags": flags,
            "confidence_scores": confidences,
            "raw_signal_summary": f"{preprocessed_signal.shape[0]} segments analyzed",
        }


# Singleton-like accessor
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
