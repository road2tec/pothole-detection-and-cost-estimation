"""Pretrained Hugging Face pothole detector adapter.

The adapter downloads the pinned checkpoint once into MODEL_CACHE_DIR, loads it with the
framework the checkpoint needs (Ultralytics for the verified presets), and returns real model
outputs. It never fabricates detections: if loading or inference fails, it raises.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from importlib import metadata
from typing import Any

import cv2
import numpy as np

from app.core.config import Settings
from app.models.registry import PRESETS, DetectorPreset

log = logging.getLogger(__name__)


class ModelNotReady(RuntimeError):
    """Raised when inference is requested but the model is not loaded."""


@dataclass
class Detection:
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2 in original image pixels
    mask_polygon: list[list[float]] | None = None
    mask_area_px: float | None = None
    # Oriented (minimum-area rectangle) dimensions of the mask, in pixels.
    mask_length_px: float | None = None
    mask_width_px: float | None = None

    @property
    def bbox_length_px(self) -> float:
        x1, y1, x2, y2 = self.bbox
        return max(x2 - x1, y2 - y1)

    @property
    def bbox_width_px(self) -> float:
        x1, y1, x2, y2 = self.bbox
        return min(x2 - x1, y2 - y1)


@dataclass
class ModelState:
    status: str = "not_loaded"  # not_loaded | loading | ready | error
    error: str | None = None
    weights_path: str | None = None
    loaded_at: float | None = None
    load_seconds: float | None = None
    device: str | None = None
    labels: dict[int, str] = field(default_factory=dict)
    task: str | None = None
    inference_count: int = 0
    last_inference_ms: float | None = None


def _package_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def resolve_device(requested: str) -> str:
    import torch

    if requested == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if requested.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError(f"DEVICE={requested} requested but CUDA is not available")
    return requested


class PotholeDetector:
    def __init__(self, settings: Settings):
        self.settings = settings
        preset = PRESETS.get(settings.detector_preset)
        if preset is None and not (settings.hf_repo_id and settings.hf_checkpoint):
            raise ValueError(
                f"Unknown DETECTOR_PRESET '{settings.detector_preset}'. "
                f"Use one of {sorted(PRESETS)} or set HF_REPO_ID and HF_CHECKPOINT."
            )
        self.preset: DetectorPreset | None = preset
        self.repo_id = settings.hf_repo_id or preset.repo_id  # type: ignore[union-attr]
        self.revision = settings.hf_revision or (preset.revision if preset else None)
        self.checkpoint = settings.hf_checkpoint or preset.checkpoint  # type: ignore[union-attr]
        self.state = ModelState()
        self._model: Any = None
        self._lock = threading.Lock()  # Ultralytics predictors are not thread-safe.

    # ------------------------------------------------------------------ metadata
    @property
    def model_version(self) -> str:
        rev = (self.revision or "unpinned")[:12]
        return f"{self.repo_id}@{rev}/{self.checkpoint}"

    def info(self) -> dict[str, Any]:
        p = self.preset
        return {
            "repositoryId": self.repo_id,
            "revision": self.revision,
            "revisionPinned": bool(self.revision and len(self.revision) == 40),
            "checkpoint": self.checkpoint,
            "modelVersion": self.model_version,
            "preset": p.key if p else None,
            "framework": p.framework if p else "ultralytics",
            "frameworkVersion": _package_version("ultralytics"),
            "torchVersion": _package_version("torch"),
            "task": self.state.task or (p.task if p else None),
            "licence": p.licence if p else "Unknown — verify before use",
            "licenceNote": p.licence_note if p else None,
            "sourceNote": p.source_note if p else None,
            "classLabels": list(self.state.labels.values()) or (list(p.expected_labels) if p else []),
            "confidenceThreshold": self.settings.confidence_threshold,
            "iouThreshold": self.settings.iou_threshold,
            "imageSize": self.settings.inference_image_size,
            "device": self.state.device or self.settings.device,
            "cachePath": str(self.settings.model_cache_dir),
            "trainedByThisProject": False,
        }

    def status(self) -> dict[str, Any]:
        s = self.state
        return {
            "status": s.status,
            "ready": s.status == "ready",
            "error": s.error,
            "weightsPath": s.weights_path,
            "loadSeconds": s.load_seconds,
            "loadedAt": s.loaded_at,
            "device": s.device,
            "inferenceCount": s.inference_count,
            "lastInferenceMs": s.last_inference_ms,
            "modelVersion": self.model_version,
        }

    # ------------------------------------------------------------------ loading
    def _download(self) -> str:
        from huggingface_hub import hf_hub_download

        self.settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
        return hf_hub_download(
            repo_id=self.repo_id,
            filename=self.checkpoint,
            revision=self.revision,
            cache_dir=str(self.settings.model_cache_dir),
            local_files_only=self.settings.hf_offline,
        )

    def load(self) -> None:
        """Download (once) and load the checkpoint. Errors are recorded, never hidden."""
        self.state = ModelState(status="loading")
        started = time.perf_counter()
        try:
            missing = [p for p in ("ultralytics", "torch") if _package_version(p) is None]
            if missing:
                raise RuntimeError(f"Missing required packages: {', '.join(missing)}")
            device = resolve_device(self.settings.device)
            weights = self._download()
            from ultralytics import YOLO

            model = YOLO(weights)
            names = {int(k): str(v) for k, v in dict(model.names).items()}
            if not any("pothole" in n.lower() for n in names.values()):
                raise RuntimeError(
                    f"Checkpoint classes {list(names.values())} do not include a pothole class; "
                    "refusing to use a generic detector."
                )
            # Warm-up pass so the first real request does not pay the graph set-up cost.
            model.predict(np.zeros((320, 320, 3), dtype=np.uint8), device=device, verbose=False)
            self._model = model
            self.state = ModelState(
                status="ready",
                weights_path=weights,
                loaded_at=time.time(),
                load_seconds=round(time.perf_counter() - started, 2),
                device=device,
                labels=names,
                task=str(model.task),
            )
            log.info("Detector ready: %s on %s", self.model_version, device)
        except Exception as exc:  # noqa: BLE001 — surfaced through /model/status
            log.exception("Detector failed to load")
            self._model = None
            self.state = ModelState(status="error", error=f"{type(exc).__name__}: {exc}")

    # ------------------------------------------------------------------ inference
    def predict(self, image_bgr: np.ndarray, confidence: float | None = None) -> tuple[list[Detection], float]:
        """Run inference on a BGR image. Returns (detections, inference_ms)."""
        if self._model is None or self.state.status != "ready":
            raise ModelNotReady(self.state.error or "Model is not loaded")
        if image_bgr is None or image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
            raise ValueError("Expected a 3-channel colour image")
        conf = self.settings.confidence_threshold if confidence is None else confidence
        started = time.perf_counter()
        with self._lock:
            result = self._model.predict(
                image_bgr,
                conf=conf,
                iou=self.settings.iou_threshold,
                imgsz=self.settings.inference_image_size,
                device=self.state.device,
                verbose=False,
            )[0]
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        self.state.inference_count += 1
        self.state.last_inference_ms = elapsed_ms
        return self._parse(result), elapsed_ms

    def _parse(self, result: Any) -> list[Detection]:
        detections: list[Detection] = []
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return detections
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)
        polygons = result.masks.xy if getattr(result, "masks", None) is not None else None
        for i in range(len(xyxy)):
            label = self.state.labels.get(int(classes[i]), str(classes[i]))
            if "pothole" not in label.lower():
                continue
            x1, y1, x2, y2 = (float(v) for v in xyxy[i])
            det = Detection(label=label, confidence=float(confs[i]), bbox=(x1, y1, x2, y2))
            if polygons is not None and i < len(polygons) and len(polygons[i]) >= 3:
                poly = np.asarray(polygons[i], dtype=np.float32)
                det.mask_polygon = [[round(float(x), 1), round(float(y), 1)] for x, y in poly]
                det.mask_area_px = float(cv2.contourArea(poly))
                (_, _), (w, h), _ = cv2.minAreaRect(poly)
                det.mask_length_px = float(max(w, h))
                det.mask_width_px = float(min(w, h))
            detections.append(det)
        detections.sort(key=lambda d: d.confidence, reverse=True)
        return detections
