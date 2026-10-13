"""Single-image pipeline: detect -> annotate -> crop -> (optional) depth -> calibrated geometry."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.core.security import to_relative
from app.services.depth.estimator import DepthEstimator, sample_pothole_depth
from app.services.detection.adapter import Detection, PotholeDetector
from app.services.detection.annotate import crop, draw_detections, write_jpeg
from app.services.measurement.geometry import bbox_dimensions_homography, scaled_depth_m


@dataclass
class CalibrationInput:
    """Calibration supplied by the caller. All fields optional; nothing is assumed."""

    metres_per_pixel: float | None = None
    homography: list[float] | None = None
    depth_alpha: float | None = None
    camera_height_m: float | None = None


def measure_detection(det: Detection, calib: CalibrationInput | None) -> dict[str, Any]:
    """Pixel dimensions always; metric dimensions only when calibration supports them."""
    m: dict[str, Any] = {
        "bboxLengthPx": round(det.bbox_length_px, 1),
        "bboxWidthPx": round(det.bbox_width_px, 1),
        "maskLengthPx": round(det.mask_length_px, 1) if det.mask_length_px else None,
        "maskWidthPx": round(det.mask_width_px, 1) if det.mask_width_px else None,
        "maskAreaPx": round(det.mask_area_px, 1) if det.mask_area_px else None,
        "lengthM": None,
        "widthM": None,
        "dimensionSource": None,
        "limitations": [],
    }
    if calib is None or (calib.metres_per_pixel is None and not calib.homography):
        m["limitations"].append("Not calibrated: physical dimensions require a reference object or camera profile.")
        return m
    if calib.homography:
        length, width = bbox_dimensions_homography(calib.homography, det.bbox)
        m.update(lengthM=round(length, 4), widthM=round(width, 4), dimensionSource="homography")
        m["limitations"].append("Homography assumes a flat road plane; box corners are mapped, not the pothole outline.")
    elif calib.metres_per_pixel:
        s = calib.metres_per_pixel
        if det.mask_length_px and det.mask_width_px:
            m.update(lengthM=round(det.mask_length_px * s, 4), widthM=round(det.mask_width_px * s, 4),
                     dimensionSource="mask")
        else:
            m.update(lengthM=round(det.bbox_length_px * s, 4), widthM=round(det.bbox_width_px * s, 4),
                     dimensionSource="bbox")
            m["limitations"].append("Bounding-box dimensions overestimate irregular potholes.")
        m["limitations"].append("A single scale is valid only near the reference object's plane and distance.")
    return m


def run_image(
    image: np.ndarray,
    detector: PotholeDetector,
    depth: DepthEstimator | None,
    out_dir: Path,
    stem: str,
    confidence: float | None,
    calib: CalibrationInput | None,
    include_depth: bool,
) -> dict[str, Any]:
    detections, inference_ms = detector.predict(image, confidence)
    h, w = image.shape[:2]
    annotated_rel: str | None = None
    out_dir.mkdir(parents=True, exist_ok=True)
    annotated = draw_detections(image, detections)
    annotated_path = out_dir / f"{stem}_annotated.jpg"
    write_jpeg(annotated_path, annotated)
    annotated_rel = to_relative(annotated_path)

    depth_ms = None
    disparity = None
    depth_status = "not_requested"
    if include_depth and detections:
        if depth is not None and depth.ready:
            disparity, depth_ms = depth.depth_map(image)
            depth_status = "ok"
        else:
            depth_status = "unavailable"

    items = []
    for i, det in enumerate(detections):
        crop_path = out_dir / f"{stem}_crop_{i + 1}.jpg"
        write_jpeg(crop_path, crop(image, det.bbox))
        measurement = measure_detection(det, calib)
        depth_info: dict[str, Any] = {"status": depth_status, "relativeDepth": None, "depthM": None}
        if disparity is not None:
            sample = sample_pothole_depth(disparity, det.bbox)
            depth_info.update(relativeDepth=sample.relative_depth if sample.valid else None,
                              roadReference=round(sample.road_reference, 4),
                              pitValue=round(sample.pit_value, 4),
                              valid=sample.valid, reason=sample.reason)
            if sample.valid and calib is not None:
                depth_info["depthM"] = scaled_depth_m(sample.relative_depth, calib.depth_alpha, calib.camera_height_m)
            if depth_info["depthM"] is None:
                depth_info["reason"] = depth_info.get("reason") or (
                    "Relative depth only: physical depth needs a fitted depth factor (alpha) and camera height."
                )
        items.append({
            "index": i + 1,
            "label": det.label,
            "confidence": round(det.confidence, 4),
            "bbox": {"x1": round(det.bbox[0], 1), "y1": round(det.bbox[1], 1),
                     "x2": round(det.bbox[2], 1), "y2": round(det.bbox[3], 1)},
            "maskPolygon": det.mask_polygon,
            "cropPath": to_relative(crop_path),
            "measurement": measurement,
            "depth": depth_info,
        })

    return {
        "imageWidth": w,
        "imageHeight": h,
        "detectionCount": len(items),
        "detections": items,
        "annotatedPath": annotated_rel,
        "inferenceMs": inference_ms,
        "depthMs": depth_ms,
        "depthModelVersion": depth.model_version if depth is not None and depth_status == "ok" else None,
        "modelVersion": detector.model_version,
        "confidenceThreshold": confidence if confidence is not None else detector.settings.confidence_threshold,
        "task": detector.state.task,
    }
