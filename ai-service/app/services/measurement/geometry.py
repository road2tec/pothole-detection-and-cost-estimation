"""Calibration geometry: reference scale, homography (inverse perspective mapping) and depth scaling.

Nothing here assumes a camera height or angle. Every conversion needs explicit calibration input.
"""
from __future__ import annotations

import math

import cv2
import numpy as np


class CalibrationError(ValueError):
    pass


def scale_from_reference(reference_length_m: float, p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Report Eq. 4.3: metres per pixel = real length / pixel length."""
    if not math.isfinite(reference_length_m) or reference_length_m <= 0:
        raise CalibrationError("Reference length must be greater than zero")
    px = math.dist(p1, p2)
    if px < 5:
        raise CalibrationError("Reference points must be at least 5 pixels apart")
    return reference_length_m / px


def homography_from_points(image_pts: list[tuple[float, float]], road_pts_m: list[tuple[float, float]]) -> list[float]:
    """Report Eq. 4.5: 3x3 matrix mapping image pixels to road-plane metres (row-major, 9 values)."""
    if len(image_pts) != 4 or len(road_pts_m) != 4:
        raise CalibrationError("Exactly four image points and four road-plane points are required")
    src = np.asarray(image_pts, dtype=np.float32)
    dst = np.asarray(road_pts_m, dtype=np.float32)
    if abs(cv2.contourArea(src)) < 100:
        raise CalibrationError("Image points are degenerate (nearly collinear or too close)")
    if abs(cv2.contourArea(dst)) < 1e-4:
        raise CalibrationError("Road-plane points are degenerate")
    h = cv2.getPerspectiveTransform(src, dst)
    if not np.all(np.isfinite(h)):
        raise CalibrationError("Homography could not be computed")
    return [float(v) for v in h.ravel()]


def apply_homography(h9: list[float], pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    h = np.asarray(h9, dtype=np.float64).reshape(3, 3)
    arr = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
    out = cv2.perspectiveTransform(arr, h).reshape(-1, 2)
    return [(float(x), float(y)) for x, y in out]


def bbox_dimensions_homography(h9: list[float], bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    """Map the four box corners onto the road plane; return (length, width) in metres."""
    x1, y1, x2, y2 = bbox
    tl, tr, br, bl = apply_homography(h9, [(x1, y1), (x2, y1), (x2, y2), (x1, y2)])
    top, bottom = math.dist(tl, tr), math.dist(bl, br)
    left, right = math.dist(tl, bl), math.dist(tr, br)
    a, b = (top + bottom) / 2, (left + right) / 2
    return max(a, b), min(a, b)


def scaled_depth_m(relative_depth: float, alpha: float | None, camera_height_m: float | None) -> float | None:
    """Report Eq. 4.6: D = alpha * relative_depth * Z.

    Returns None unless alpha (fitted against hand-measured depths) and the camera-to-road
    distance Z are both provided. Without them relative depth cannot be expressed in metres.
    """
    if alpha is None or camera_height_m is None:
        return None
    if alpha <= 0 or camera_height_m <= 0 or relative_depth <= 0:
        return None
    return round(alpha * relative_depth * camera_height_m, 4)
