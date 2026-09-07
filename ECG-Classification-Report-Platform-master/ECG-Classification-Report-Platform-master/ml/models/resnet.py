"""
1D SE-ResNet for multi-label ECG classification.

This is the inference-side twin of the architecture trained in
training/ecg-train.ipynb (Stage 1). The module and parameter names MUST
stay identical to the notebook's definitions — the shipped checkpoint
models/weights/resnet1d_multilabel_best.pth was produced by that code,
so any rename here breaks state_dict loading.

Input:  (batch, 12, 5000) — 12-lead, 10-second, 500 Hz, z-scored per lead
Output: (batch, 5) — one logit per diagnostic superclass
        (NORM, MI, STTC, CD, HYP — sigmoid, NOT softmax: classes are
        independent, a record can carry several at once)
"""

import torch
import torch.nn as nn


class SEBlock(nn.Module):
    # Squeeze-and-excitation channel attention: global-pool the time axis,
    # learn per-channel weights, rescale. Cheap and effective on ECG leads.
    def __init__(self, c, r=8):
        super().__init__()
        self.fc = nn.Sequential(
            nn.Linear(c, max(c // r, 4)),
            nn.ReLU(inplace=True),
            nn.Linear(max(c // r, 4), c),
            nn.Sigmoid(),
        )

    def forward(self, x):                     # x: (B, C, T)
        w = x.mean(dim=2)                     # (B, C)
        return x * self.fc(w).unsqueeze(-1)


class ResBlock(nn.Module):
    # conv-bn-relu-conv-bn + SE attention + identity skip.
    def __init__(self, cin, cout, kernel=15, stride=1):
        super().__init__()
        pad = kernel // 2
        self.conv1 = nn.Conv1d(cin, cout, kernel, stride=stride, padding=pad, bias=False)
        self.bn1 = nn.BatchNorm1d(cout)
        self.conv2 = nn.Conv1d(cout, cout, kernel, stride=1, padding=pad, bias=False)
        self.bn2 = nn.BatchNorm1d(cout)
        self.se = SEBlock(cout)
        self.act = nn.ReLU(inplace=True)
        self.downsample = None
        if stride != 1 or cin != cout:
            self.downsample = nn.Sequential(
                nn.Conv1d(cin, cout, 1, stride=stride, bias=False),
                nn.BatchNorm1d(cout),
            )

    def forward(self, x):
        identity = x if self.downsample is None else self.downsample(x)
        out = self.act(self.bn1(self.conv1(x)))
        out = self.se(self.bn2(self.conv2(out)))
        return self.act(out + identity)


class ResNet1D(nn.Module):
    # 1D SE-ResNet for multi-label ECG classification.
    def __init__(self, num_leads=12, num_classes=5, base=64):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(num_leads, base, 15, stride=2, padding=7, bias=False),
            nn.BatchNorm1d(base),
            nn.ReLU(inplace=True),
            nn.MaxPool1d(2),
        )
        self.stage1 = nn.Sequential(ResBlock(base, base),       ResBlock(base, base))
        self.stage2 = nn.Sequential(ResBlock(base, base * 2, stride=2),   ResBlock(base * 2, base * 2))
        self.stage3 = nn.Sequential(ResBlock(base * 2, base * 3, stride=2), ResBlock(base * 3, base * 3))
        self.stage4 = nn.Sequential(ResBlock(base * 3, base * 4, stride=2), ResBlock(base * 4, base * 4))
        self.head = nn.Sequential(
            nn.AdaptiveAvgPool1d(1),
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(base * 4, num_classes),
        )

    def forward(self, x):
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = self.stage4(x)
        return self.head(x)
