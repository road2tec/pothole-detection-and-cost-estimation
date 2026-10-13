"""Pretrained monocular depth (relative) and pothole depth sampling.

Depth Anything V2 / MiDaS-style models output *relative inverse depth* (disparity): larger
values are closer to the camera, and the scale differs from image to image. These values have
no physical unit, so this module only produces a dimensionless relative depth. Converting it to
metres requires a separately fitted calibration (see app.services.measurement.depth_scaling).
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.core.config import Settings

log = logging.getLogger(__name__)


@dataclass
class DepthSample:
    road_reference: float  # median disparity in a ring around the box (intact road)
    pit_value: float  # mean disparity of the 20% farthest pixels inside the box
    relative_depth: float  # (road - pit) / road, dimensionless
    valid: bool
    reason: str | None = None


class DepthEstimator:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.status = "disabled" if not settings.depth_enabled else "not_loaded"
        self.error: str | None = None
        self.revision: str | None = settings.depth_revision
        self._pipe: Any = None
        self._lock = threading.Lock()

    @property
    def model_version(self) -> str:
        return f"{self.settings.depth_repo_id}@{(self.revision or 'unpinned')[:12]}"

    def info(self) -> dict[str, Any]:
        return {
            "enabled": self.settings.depth_enabled,
            "status": self.status,
            "error": self.error,
            "repositoryId": self.settings.depth_repo_id,
            "revision": self.revision,
            "modelVersion": self.model_version,
            "output": "relative inverse depth (unitless)",
            "licence": "Apache-2.0 (Depth-Anything-V2-Small)" if "Small" in self.settings.depth_repo_id else "verify",
            "trainedByThisProject": False,
        }

    def load(self) -> None:
        if not self.settings.depth_enabled:
            return
        self.status = "loading"
        try:
            from huggingface_hub import HfApi
            from transformers import pipeline

            if not self.revision and not self.settings.hf_offline:
                self.revision = HfApi().model_info(self.settings.depth_repo_id).sha
            self._pipe = pipeline(
                "depth-estimation",
                model=self.settings.depth_repo_id,
                revision=self.revision,
                device=-1 if self.settings.device == "cpu" else 0,
                model_kwargs={"cache_dir": str(self.settings.model_cache_dir)},
            )
            self.status = "ready"
            log.info("Depth model ready: %s", self.model_version)
        except Exception as exc:  # noqa: BLE001
            log.exception("Depth model failed to load")
            self._pipe = None
            self.status = "error"
            self.error = f"{type(exc).__name__}: {exc}"

    @property
    def ready(self) -> bool:
        return self.status == "ready" and self._pipe is not None

    def depth_map(self, image_bgr: np.ndarray) -> tuple[np.ndarray, float]:
        if not self.ready:
            raise RuntimeError(self.error or "Depth model not loaded")
        from PIL import Image

        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        started = time.perf_counter()
        with self._lock:
            out = self._pipe(Image.fromarray(rgb))
        tensor = out["predicted_depth"]
        arr = tensor.squeeze().detach().cpu().numpy().astype(np.float32)
        h, w = image_bgr.shape[:2]
        arr = cv2.resize(arr, (w, h), interpolation=cv2.INTER_LINEAR)
        return arr, round((time.perf_counter() - started) * 1000, 1)


def sample_pothole_depth(disparity: np.ndarray, bbox: tuple[float, float, float, float],
                         ring_ratio: float = 0.25, deepest_fraction: float = 0.20) -> DepthSample:
    """Report Eq. 4.6 inputs: road reference (ring median) and pit value (deepest 20% mean)."""
    h, w = disparity.shape[:2]
    x1, y1, x2, y2 = (int(round(v)) for v in bbox)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return DepthSample(0, 0, 0, False, "Bounding box too small for depth sampling")
    rx, ry = int((x2 - x1) * ring_ratio), int((y2 - y1) * ring_ratio)
    ox1, oy1, ox2, oy2 = max(0, x1 - rx), max(0, y1 - ry), min(w, x2 + rx), min(h, y2 + ry)
    ring_mask = np.zeros((h, w), dtype=bool)
    ring_mask[oy1:oy2, ox1:ox2] = True
    ring_mask[y1:y2, x1:x2] = False
    ring = disparity[ring_mask]
    inside = disparity[y1:y2, x1:x2].ravel()
    if ring.size < 20:
        return DepthSample(0, 0, 0, False, "Not enough road surface around the pothole")
    road = float(np.median(ring))
    k = max(1, int(inside.size * deepest_fraction))
    # Farthest pixels have the smallest disparity.
    pit = float(np.mean(np.partition(inside, k - 1)[:k]))
    if road <= 1e-6:
        return DepthSample(road, pit, 0, False, "Road reference disparity is not positive")
    rel = (road - pit) / road
    if rel <= 0:
        return DepthSample(road, pit, rel, False, "Pothole region does not appear deeper than the road")
    return DepthSample(road, pit, round(rel, 5), True)
