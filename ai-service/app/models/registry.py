"""Verified pretrained pothole checkpoints.

Each preset was downloaded and run on CPU with ultralytics 8.4.x before being listed here
(see docs/pretrained-model-setup.md). Revisions are pinned commit hashes so the weights cannot
change underneath the application. No preset is trained or fine-tuned by this project.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DetectorPreset:
    key: str
    repo_id: str
    revision: str
    checkpoint: str
    framework: str
    task: str  # "detect" (boxes) or "segment" (boxes + masks)
    licence: str
    licence_note: str
    expected_labels: tuple[str, ...]
    source_note: str


PRESETS: dict[str, DetectorPreset] = {
    "daniels-yolo26": DetectorPreset(
        key="daniels-yolo26",
        repo_id="DanielsStulpe/pothole-detection",
        revision="42b586f1ff38944fdd5fcc8fd6112451bbe15fb9",
        checkpoint="yolo26_best.pt",
        framework="ultralytics",
        task="detect",
        licence="MIT (stated in model card)",
        licence_note=(
            "Weights are MIT per the model card. Running them requires the Ultralytics library, "
            "which is AGPL-3.0 (or an Ultralytics enterprise licence for closed-source use)."
        ),
        expected_labels=("pothole",),
        source_note="Bachelor's thesis model trained by its author on Roboflow 'pothole-idtb2'.",
    ),
    "keremberke-yolov8n-seg": DetectorPreset(
        key="keremberke-yolov8n-seg",
        repo_id="keremberke/yolov8n-pothole-segmentation",
        revision="132feb1b360d9b3b5b3eed9b96add0ad42d2a026",
        checkpoint="best.pt",
        framework="ultralytics",
        task="segment",
        licence="Not stated in model card",
        licence_note=(
            "The repository declares no licence. Treat it as research/evaluation only until the "
            "author's terms are confirmed. Ultralytics itself is AGPL-3.0."
        ),
        expected_labels=("pothole",),
        source_note="YOLOv8n segmentation trained by its author on keremberke/pothole-segmentation.",
    ),
}
