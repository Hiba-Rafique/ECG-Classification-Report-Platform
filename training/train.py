"""
Training script for the ECG CNN classifier.

Usage:
    python -m training.train --data_dir ./data/raw/ptbxl --epochs 30 --batch_size 32

Tracks:
- Accuracy and F1 score per epoch
- False-negative and false-positive rates (core metrics for this project)
"""

import argparse
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    confusion_matrix,
    classification_report,
)

from ml.models.cnn_model import ECGClassifier
from training.dataset import PTBXLDataset, LABEL_MAP, load_ptbxl_metadata


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: optim.Optimizer,
    device: torch.device,
) -> float:
    """Train for one epoch, return average loss."""
    model.train()
    total_loss = 0.0
    num_batches = 0

    for signals, labels in loader:
        signals = signals.to(device)
        labels = labels.to(device)

        optimizer.zero_grad()
        outputs = model(signals)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        num_batches += 1

    return total_loss / max(num_batches, 1)


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    num_classes: int,
) -> dict:
    """Evaluate model, return accuracy, F1, FN rate, FP rate."""
    model.eval()
    all_preds = []
    all_labels = []

    for signals, labels in loader:
        signals = signals.to(device)
        outputs = model(signals)
        preds = outputs.argmax(dim=1).cpu().numpy()
        all_preds.extend(preds)
        all_labels.extend(labels.numpy())

    all_preds = np.array(all_preds)
    all_labels = np.array(all_labels)

    acc = accuracy_score(all_labels, all_preds)
    f1 = f1_score(all_labels, all_preds, average="macro", zero_division=0)

    # FN/FP rates (macro-averaged across classes)
    cm = confusion_matrix(all_labels, all_preds, labels=list(range(num_classes)))
    fn_rates = []
    fp_rates = []
    for i in range(num_classes):
        tp = cm[i, i]
        fn = cm[i].sum() - tp
        fp = cm[:, i].sum() - tp
        tn = cm.sum() - tp - fn - fp

        fn_rate = fn / (tp + fn) if (tp + fn) > 0 else 0.0
        fp_rate = fp / (tn + fp) if (tn + fp) > 0 else 0.0
        fn_rates.append(fn_rate)
        fp_rates.append(fp_rate)

    return {
        "accuracy": acc,
        "f1_macro": f1,
        "fn_rate_macro": np.mean(fn_rates),
        "fp_rate_macro": np.mean(fp_rates),
        "per_class_fn": fn_rates,
        "per_class_fp": fp_rates,
    }


def main():
    parser = argparse.ArgumentParser(description="Train ECG CNN classifier")
    parser.add_argument("--data_dir", type=str, default="./data/raw/ptbxl")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--val_split", type=float, default=0.2)
    parser.add_argument("--save_dir", type=str, default="./models/weights")
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()

    device = torch.device(args.device)
    save_dir = Path(args.save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    # ── Load PTB-XL metadata (labels via scp_statements.csv) ──
    print("Loading dataset...")
    print(f"  Data dir: {args.data_dir}")
    print(f"  Device:   {device}")
    print()

    record_ids, labels, file_paths = load_ptbxl_metadata(args.data_dir)
    if not record_ids:
        print(f"\nNo records found in {args.data_dir}.")
        print("Download PTB-XL from https://physionet.org/content/ptb-xl/ first,")
        print("or train on Kaggle with training/kaggle_train.ipynb.")
        sys.exit(0)

    dataset = PTBXLDataset(args.data_dir, file_paths, labels)

    # Train/val split
    val_size = int(len(dataset) * args.val_split)
    train_size = len(dataset) - val_size
    train_set, val_set = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False)

    # Model
    num_classes = len(LABEL_MAP)
    model = ECGClassifier(num_leads=12, num_classes=num_classes).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=args.lr)

    # Training loop
    best_f1 = 0.0
    for epoch in range(args.epochs):
        train_loss = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_metrics = evaluate(model, val_loader, device, num_classes)

        print(
            f"Epoch {epoch+1:3d}/{args.epochs} | "
            f"Loss: {train_loss:.4f} | "
            f"Acc: {val_metrics['accuracy']:.4f} | "
            f"F1: {val_metrics['f1_macro']:.4f} | "
            f"FN rate: {val_metrics['fn_rate_macro']:.4f} | "
            f"FP rate: {val_metrics['fp_rate_macro']:.4f}"
        )

        # Save best model
        if val_metrics["f1_macro"] > best_f1:
            best_f1 = val_metrics["f1_macro"]
            torch.save(model.state_dict(), save_dir / "best_model.pth")
            print(f"  -> Saved best model (F1={best_f1:.4f})")

    print(f"\nTraining complete. Best F1: {best_f1:.4f}")
    print(f"Model saved to: {save_dir / 'best_model.pth'}")


if __name__ == "__main__":
    main()
