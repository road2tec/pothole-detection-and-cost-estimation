"""Image decoding, annotation rendering and crop extraction."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from app.services.detection.adapter import Detection

AMBER = (11, 158, 245)  # BGR
MASK_FILL = (0, 140, 255)


class InvalidImage(ValueError):
    pass


def decode_image(data: bytes, max_pixels: int) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise InvalidImage("File is not a decodable JPEG or PNG image")
    h, w = img.shape[:2]
    if h * w > max_pixels:
        raise InvalidImage(f"Image of {w}x{h} exceeds the {max_pixels} pixel limit")
    if h < 32 or w < 32:
        raise InvalidImage("Image is too small to analyse")
    return img


def read_image(path: Path, max_pixels: int) -> np.ndarray:
    return decode_image(path.read_bytes(), max_pixels)


def draw_detections(image: np.ndarray, detections: list[Detection], labels: list[str] | None = None) -> np.ndarray:
    out = image.copy()
    h, w = out.shape[:2]
    thickness = max(2, round(min(h, w) / 300))
    font_scale = max(0.5, min(h, w) / 1100)
    overlay = out.copy()
    for det in detections:
        if det.mask_polygon:
            pts = np.asarray(det.mask_polygon, dtype=np.int32)
            cv2.fillPoly(overlay, [pts], MASK_FILL)
    if any(d.mask_polygon for d in detections):
        out = cv2.addWeighted(overlay, 0.35, out, 0.65, 0)
    for i, det in enumerate(detections):
        x1, y1, x2, y2 = (int(round(v)) for v in det.bbox)
        cv2.rectangle(out, (x1, y1), (x2, y2), AMBER, thickness)
        text = labels[i] if labels else f"#{i + 1} {det.label} {det.confidence:.2f}"
        (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, max(1, thickness - 1))
        ty = y1 - 6 if y1 - th - 10 > 0 else y1 + th + 10
        cv2.rectangle(out, (x1, ty - th - 6), (x1 + tw + 8, ty + base - 2), AMBER, -1)
        cv2.putText(out, text, (x1 + 4, ty - 2), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (20, 20, 20),
                    max(1, thickness - 1), cv2.LINE_AA)
    return out


def crop(image: np.ndarray, bbox: tuple[float, float, float, float], pad_ratio: float = 0.12) -> np.ndarray:
    h, w = image.shape[:2]
    x1, y1, x2, y2 = bbox
    px, py = (x2 - x1) * pad_ratio, (y2 - y1) * pad_ratio
    a, b = max(0, int(x1 - px)), max(0, int(y1 - py))
    c, d = min(w, int(x2 + px)), min(h, int(y2 + py))
    return image[b:d, a:c].copy()


def write_jpeg(path: Path, image: np.ndarray, quality: int = 88) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError(f"Could not encode {path.name}")
    path.write_bytes(buf.tobytes())
