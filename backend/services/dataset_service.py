from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from config import DATASETS_DIR, UPLOAD_DIR


# Ground truth file patterns (priority order)
GT_PATTERNS = [
    "gt.csv", "gt.txt", "ground_truth.txt", "ground_truth.csv",
]
GT_SUFFIX_PATTERNS = ["_gt.csv", "_gt.txt"]
GT_KEYWORD_PATTERNS = ["mapping"]


def _find_data_file(dataset_dir: Path) -> Optional[Path]:
    """Find the main data CSV file in a dataset directory."""
    csv_files = sorted(dataset_dir.glob("*.csv"))
    # Exclude ground truth files
    for f in csv_files:
        name_lower = f.name.lower()
        if any(name_lower == p for p in GT_PATTERNS):
            continue
        if any(name_lower.endswith(p) for p in GT_SUFFIX_PATTERNS):
            continue
        if any(kw in name_lower for kw in GT_KEYWORD_PATTERNS):
            continue
        return f
    # Also check xlsx
    xlsx_files = sorted(dataset_dir.glob("*.xlsx"))
    for f in xlsx_files:
        name_lower = f.name.lower()
        if "gt" not in name_lower and "mapping" not in name_lower:
            return f
    return None


def _find_gt_file(dataset_dir: Path) -> Optional[Path]:
    """Find the ground truth file in a dataset directory."""
    # Check exact patterns first
    for pattern in GT_PATTERNS:
        p = dataset_dir / pattern
        if p.exists():
            return p

    # Check suffix patterns
    for f in sorted(dataset_dir.iterdir()):
        name_lower = f.name.lower()
        if any(name_lower.endswith(p) for p in GT_SUFFIX_PATTERNS):
            return f

    # Check keyword patterns
    for f in sorted(dataset_dir.iterdir()):
        name_lower = f.name.lower()
        if any(kw in name_lower for kw in GT_KEYWORD_PATTERNS):
            return f

    return None


def _read_csv(path: Path) -> pd.DataFrame:
    """Read CSV with encoding fallback."""
    try:
        return pd.read_csv(path, encoding="utf-8")
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="mac_roman")


def list_datasets() -> list[dict[str, Any]]:
    """List all available datasets."""
    results = []

    # Scan LLMCER datasets directory
    for source_dir in [DATASETS_DIR, UPLOAD_DIR]:
        if not source_dir.exists():
            continue
        for entry in sorted(source_dir.iterdir()):
            if not entry.is_dir():
                continue
            if entry.name == 'test_mini':
                continue
            data_file = _find_data_file(entry)
            if data_file is None:
                continue
            gt_file = _find_gt_file(entry)
            try:
                df = _read_csv(data_file)
                record_count = len(df)
                columns = list(df.columns)
            except Exception:
                record_count = 0
                columns = []

            results.append({
                "name": entry.name,
                "record_count": record_count,
                "columns": columns,
                "has_ground_truth": gt_file is not None,
                "data_file": str(data_file),
                "ground_truth_file": str(gt_file) if gt_file else None,
            })

    return results


def get_dataset_detail(name: str, preview_rows: int = 10) -> Optional[dict[str, Any]]:
    """Get dataset detail with preview rows."""
    dataset_dir = _resolve_dataset_dir(name)
    if dataset_dir is None:
        return None

    data_file = _find_data_file(dataset_dir)
    if data_file is None:
        return None

    gt_file = _find_gt_file(dataset_dir)
    df = _read_csv(data_file)

    preview = df.head(preview_rows).fillna("").to_dict(orient="records")

    return {
        "name": name,
        "record_count": len(df),
        "columns": list(df.columns),
        "has_ground_truth": gt_file is not None,
        "data_file": str(data_file),
        "ground_truth_file": str(gt_file) if gt_file else None,
        "preview": preview,
    }


def get_dataset_records(
    name: str, offset: int = 0, limit: int = 50
) -> Optional[dict[str, Any]]:
    """Get paginated dataset records."""
    dataset_dir = _resolve_dataset_dir(name)
    if dataset_dir is None:
        return None

    data_file = _find_data_file(dataset_dir)
    if data_file is None:
        return None

    df = _read_csv(data_file)
    total = len(df)
    page = df.iloc[offset : offset + limit].fillna("").to_dict(orient="records")

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "records": page,
    }


def get_dataset_data_path(name: str) -> Optional[str]:
    """Get the data file path for a dataset (used by pipeline)."""
    dataset_dir = _resolve_dataset_dir(name)
    if dataset_dir is None:
        return None
    data_file = _find_data_file(dataset_dir)
    return str(data_file) if data_file else None


def get_dataset_gt_path(name: str) -> Optional[str]:
    """Get the ground truth file path for a dataset."""
    dataset_dir = _resolve_dataset_dir(name)
    if dataset_dir is None:
        return None
    gt_file = _find_gt_file(dataset_dir)
    return str(gt_file) if gt_file else None


def _resolve_dataset_dir(name: str) -> Optional[Path]:
    """Resolve dataset name to directory path, checking both sources."""
    for source_dir in [DATASETS_DIR, UPLOAD_DIR]:
        d = source_dir / name
        if d.is_dir():
            return d
    return None


def get_gt_entity_map(name: str) -> Optional[dict[str, int]]:
    """Parse GT file and return {recordId: colorIndex(1-8)} mapping."""
    dataset_dir = _resolve_dataset_dir(name)
    if dataset_dir is None:
        return None
    gt_file = _find_gt_file(dataset_dir)
    if gt_file is None:
        return None

    clusters = _parse_gt_clusters(gt_file)
    if not clusters:
        return None

    # Assign color indices 1-8 (cycling) to each cluster
    entity_map: dict[str, int] = {}
    for i, cluster in enumerate(clusters):
        color_idx = (i % 8) + 1
        for rid in cluster:
            entity_map[str(rid)] = color_idx
    return entity_map


def _parse_gt_clusters(gt_file: Path) -> list[list[int]]:
    """Parse a ground truth file into a list of entity clusters."""
    suffix = gt_file.suffix.lower()

    if suffix == ".txt":
        clusters = []
        with open(gt_file, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split()
                if parts:
                    try:
                        cluster = [int(p) for p in parts]
                        clusters.append(cluster)
                    except ValueError:
                        continue
        return clusters

    elif suffix == ".csv":
        df = _read_csv(gt_file)
        if df.shape[1] < 2:
            return []
        pairs = df.iloc[:, :2].values.tolist()
        return _merge_pairs(pairs)

    elif suffix == ".xlsx":
        df = pd.read_excel(gt_file)
        if df.shape[1] < 2:
            return []
        pairs = df.iloc[:, :2].values.tolist()
        return _merge_pairs(pairs)

    return []


def _merge_pairs(pairs: list) -> list[list[int]]:
    """Merge id pairs into clusters using union-find."""
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    ids: set[int] = set()
    for a, b in pairs:
        try:
            a, b = int(a), int(b)
        except (ValueError, TypeError):
            continue
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        union(a, b)
        ids.add(a)
        ids.add(b)

    groups: dict[int, list[int]] = {}
    for rid in ids:
        root = find(rid)
        groups.setdefault(root, []).append(rid)
    return list(groups.values())


def save_uploaded_dataset(
    name: str,
    content: bytes,
    filename: str,
    gt_content: bytes | None = None,
    gt_filename: str | None = None,
) -> dict[str, Any]:
    """Save an uploaded CSV file as a new dataset, with optional ground-truth."""
    dataset_dir = UPLOAD_DIR / name
    dataset_dir.mkdir(parents=True, exist_ok=True)
    dest = dataset_dir / filename
    dest.write_bytes(content)

    # Verify it's a valid CSV
    df = _read_csv(dest)

    gt_path = None
    if gt_content and gt_filename:
        gt_path = dataset_dir / gt_filename
        gt_path.write_bytes(gt_content)

    return {
        "name": name,
        "record_count": len(df),
        "columns": list(df.columns),
        "has_ground_truth": gt_path is not None,
        "data_file": str(dest),
        "ground_truth_file": str(gt_path) if gt_path else None,
    }
