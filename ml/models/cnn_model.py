"""
1D CNN model for ECG classification.

Architecture: Several conv+pool blocks → batch norm → dense layers → output.
Designed for record-level classification of 12-lead ECG signals.
"""

import torch
import torch.nn as nn
from typing import Optional


class ECGClassifier(nn.Module):
    """
    1D CNN for ECG abnormality classification.

    Input shape:  (batch, channels=12, segment_samples=5000)
    Output shape: (batch, num_classes)
    """

    def __init__(
        self,
        num_leads: int = 12,
        num_classes: int = 5,
        segment_samples: int = 5000,
    ):
        super().__init__()

        self.num_leads = num_leads
        self.num_classes = num_classes

        # Feature extraction blocks
        self.features = nn.Sequential(
            # Block 1
            nn.Conv1d(num_leads, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=2),

            # Block 2
            nn.Conv1d(32, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=2),

            # Block 3
            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(kernel_size=2),

            # Block 4
            nn.Conv1d(128, 256, kernel_size=3, padding=1),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool1d(1),  # Global average pooling
        )

        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (batch, num_leads, segment_samples)
        Returns:
            logits: (batch, num_classes)
        """
        x = self.features(x)            # (batch, 256, 1)
        x = x.squeeze(-1)               # (batch, 256)
        x = self.classifier(x)          # (batch, num_classes)
        return x
