from __future__ import annotations

from typing import Any, Optional

from llmcer.metrics import (
    calculate_purity,
    calculate_inverse_purity,
    calculate_fp_measure,
    calculate_ari,
    calculate_nmi,
    calculate_bcubed_metrics,
    calculate_pairwise_metrics,
)
from llmcer.data_utils import get_ground_truth


def compute_all_metrics(
    final_clusters: list[list],
    gt_path: Optional[str],
    all_ids: list,
) -> Optional[dict[str, Any]]:
    """Compute all evaluation metrics given clusters and ground truth."""
    if gt_path is None:
        return None

    try:
        ground_truth = get_ground_truth(gt_path)
    except Exception:
        return None

    if not ground_truth:
        return None

    # Augment ground truth with singletons for IDs not in any GT cluster
    gt_ids = set()
    for cluster in ground_truth:
        for item in cluster:
            gt_ids.add(str(item).strip())

    for item in all_ids:
        if str(item).strip() not in gt_ids:
            ground_truth.append([item])

    purity = calculate_purity(ground_truth, final_clusters)
    inv_purity = calculate_inverse_purity(ground_truth, final_clusters)
    f_measure = calculate_fp_measure(ground_truth, final_clusters)
    ari = calculate_ari(ground_truth, final_clusters)
    nmi = calculate_nmi(ground_truth, final_clusters)
    bcubed = calculate_bcubed_metrics(ground_truth, final_clusters)
    pairwise = calculate_pairwise_metrics(ground_truth, final_clusters)

    return {
        "purity": round(purity, 4),
        "inverse_purity": round(inv_purity, 4),
        "f_measure": round(f_measure, 4),
        "ari": round(ari, 4),
        "nmi": round(nmi, 4),
        "bcubed_precision": round(bcubed["precision"], 4),
        "bcubed_recall": round(bcubed["recall"], 4),
        "bcubed_f1": round(bcubed["f1"], 4),
        "pairwise_accuracy": round(pairwise["accuracy"], 4) if pairwise else None,
        "pairwise_precision": round(pairwise["precision"], 4) if pairwise else None,
        "pairwise_recall": round(pairwise["recall"], 4) if pairwise else None,
        "pairwise_f1": round(pairwise["f1"], 4) if pairwise else None,
    }
