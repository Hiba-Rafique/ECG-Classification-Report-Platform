"""
PyTorch Dataset and metadata loading for PTB-XL ECG records.

This is the LOCAL training path. It mirrors training/kaggle_train.ipynb —
the notebook used to produce models/weights/best_model.pth — so keep the
two in sync when changing either:

- Metadata comes from scp_statements.csv (the authoritative SCP→superclass
  mapping shipped with PTB-XL), never from a hardcoded dict.
- Each record gets a single superclass label, priority: MI > CD > HYP > STTC > NORM.
- Signals are the 500 Hz records referenced by the filename_hr column,
  loaded with wfdb.
- Preprocessing is the shared ml/preprocessing.py pipeline (same as inference).
"""

import ast
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

import torch
import wfdb
from torch.utils.data import Dataset

from ml.preprocessing import preprocess_ecg


# Label mapping for PTB-XL diagnostic superclasses (must match ml/inference.py)
LABEL_MAP = {
    "NORM": 0,  # Normal
    "MI": 1,    # Myocardial Infarction
    "CD": 2,    # Conduction Disturbance
    "HYP": 3,   # Hypertrophy
    "STTC": 4,  # ST-T Abnormality
}
LABEL_NAMES = [name for name, _ in sorted(LABEL_MAP.items(), key=lambda kv: kv[1])]

# Priority when a record carries multiple superclass labels
SUPERCLASS_PRIORITY = ["MI", "CD", "HYP", "STTC", "NORM"]


def load_ptbxl_metadata(data_dir) -> Tuple[List[str], Dict[str, int], Dict[str, str]]:
    """
    Load record IDs, labels, and file paths from the PTB-XL metadata CSVs.

    Returns (record_ids, labels, file_paths) where file_paths maps record_id
    → relative record path without extension (e.g. 'records500/00000/00001_hr').
    """
    data_dir = Path(data_dir)

    # 1. SCP→superclass mapping from scp_statements.csv
    import pandas as pd

    scp_statements = pd.read_csv(data_dir / "scp_statements.csv", index_col=0)
    diagnostic_codes = scp_statements[scp_statements.diagnostic == 1]
    code_to_superclass = dict(zip(diagnostic_codes.index, diagnostic_codes.diagnostic_class))

    # 2. Record metadata
    df = pd.read_csv(data_dir / "ptbxl_database.csv", index_col="ecg_id")
    df["scp_codes"] = df["scp_codes"].apply(ast.literal_eval)

    # 3. Single superclass per record (priority order above)
    record_ids: List[str] = []
    labels: Dict[str, int] = {}
    file_paths: Dict[str, str] = {}
    skipped = 0

    for ecg_id, row in df.iterrows():
        scp_codes = row["scp_codes"]
        assigned = None
        for supercls in SUPERCLASS_PRIORITY:
            if any(code_to_superclass.get(code) == supercls for code in scp_codes):
                assigned = supercls
                break

        if assigned is None:
            skipped += 1
            continue

        rid = str(ecg_id).zfill(5)
        record_ids.append(rid)
        labels[rid] = LABEL_MAP[assigned]
        file_paths[rid] = row["filename_hr"]  # 500 Hz path from the CSV

    print(f"Loaded {len(record_ids)} records ({skipped} skipped)")
    print(f"SCP codes mapped via scp_statements.csv: {len(code_to_superclass)} diagnostic codes")

    dist = Counter(labels.values())
    for cls_id in sorted(dist):
        print(f"  {LABEL_NAMES[cls_id]:6s}: {dist[cls_id]:5d}  ({dist[cls_id] / len(labels) * 100:.1f}%)")

    return record_ids, labels, file_paths


class PTBXLDataset(Dataset):
    """
    Dataset for PTB-XL records.

    Expected directory structure (download from https://physionet.org/content/ptb-xl/):
        data/raw/ptbxl/
            records500/00000/00001_hr.dat + 00001_hr.hea
            ptbxl_database.csv
            scp_statements.csv
    """

    def __init__(
        self,
        data_dir: str,
        file_paths: Dict[str, str],
        labels: Dict[str, int],
        record_ids: List[str] | None = None,
    ):
        self.data_dir = Path(data_dir)
        # Restrict to a subset (e.g. train/val folds) when record_ids is given
        self.record_ids = list(record_ids) if record_ids is not None else list(file_paths.keys())
        self.file_paths = file_paths
        self.labels = labels

    def __len__(self) -> int:
        return len(self.record_ids)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        rid = self.record_ids[idx]
        # wfdb takes the record path WITHOUT extension (.dat/.hea are inferred)
        record = wfdb.rdrecord(str(self.data_dir / self.file_paths[rid]))
        preprocessed = preprocess_ecg(record.p_signal, record.fs)  # (segments, samples, leads)
        signal = preprocessed[0]  # first 10 s segment
        label = self.labels[rid]

        # (leads, samples) for Conv1d
        return torch.from_numpy(signal.T).float(), label
