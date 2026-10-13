"""Evaluate the configured PRETRAINED detector on a labelled image set. No training happens here.

Ground truth formats:
  * gt.json  — {"image.jpg": {"bboxes": [[x, y, w, h], ...]}, ...}   (COCO-style boxes, pixels)
  * YOLO     — images/*.jpg with labels/*.txt lines "cls cx cy w h" (normalised)

Usage (from ai-service/):
  .venv/Scripts/python -m scripts.evaluate_model --images tests/fixtures/images --gt tests/fixtures/images/gt.json
  .venv/Scripts/python -m scripts.evaluate_model --images data/test/images --yolo-labels data/test/labels --out eval.json

Prints precision / recall at the configured confidence threshold (IoU 0.5) and mAP@0.5 and
mAP@0.5:0.95 (all-point interpolation). Results can be recorded in the application with
POST /api/v1/ai/evaluations so they appear on the AI model page and in Power BI.
Report the dataset honestly: a small or in-distribution set does not measure field accuracy.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.services.detection.adapter import PotholeDetector  # noqa: E402
from app.services.detection.annotate import read_image  # noqa: E402
from app.services.video.tracker import iou  # noqa: E402


def load_gt(args: argparse.Namespace) -> dict[str, list[tuple[float, float, float, float]]]:
    gt: dict[str, list[tuple[float, float, float, float]]] = {}
    images = Path(args.images)
    if args.gt:
        raw = json.loads(Path(args.gt).read_text())
        for name, entry in raw.items():
            gt[name] = [(x, y, x + w, y + h) for x, y, w, h in entry["bboxes"]]
        return gt
    labels = Path(args.yolo_labels)
    import cv2

    for img in sorted(images.glob("*")):
        if img.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        h, w = cv2.imread(str(img)).shape[:2]
        boxes = []
        lbl = labels / f"{img.stem}.txt"
        if lbl.exists():
            for line in lbl.read_text().splitlines():
                parts = line.split()
                if len(parts) >= 5:
                    _, cx, cy, bw, bh = map(float, parts[:5])
                    boxes.append(((cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h))
        gt[img.name] = boxes
    return gt


def average_precision(preds: list[tuple[str, float, tuple]], gt: dict[str, list[tuple]], thr: float) -> float:
    n_gt = sum(len(v) for v in gt.values())
    if n_gt == 0:
        return float("nan")
    used = {k: np.zeros(len(v), dtype=bool) for k, v in gt.items()}
    tp, fp = [], []
    for name, _conf, box in sorted(preds, key=lambda p: -p[1]):
        boxes = gt.get(name, [])
        best, best_i = 0.0, -1
        for i, g in enumerate(boxes):
            v = iou(box, g)
            if v > best:
                best, best_i = v, i
        if best >= thr and not used[name][best_i]:
            used[name][best_i] = True
            tp.append(1)
            fp.append(0)
        else:
            tp.append(0)
            fp.append(1)
    tp_c, fp_c = np.cumsum(tp), np.cumsum(fp)
    recall = tp_c / n_gt
    precision = tp_c / np.maximum(tp_c + fp_c, 1e-9)
    mrec = np.concatenate([[0.0], recall, [1.0]])
    mpre = np.concatenate([[1.0], precision, [0.0]])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--images", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--gt")
    g.add_argument("--yolo-labels")
    ap.add_argument("--out")
    args = ap.parse_args()

    settings = get_settings()
    det = PotholeDetector(settings)
    det.load()
    if det.state.status != "ready":
        sys.exit(f"Model not available: {det.state.error}")
    gt = load_gt(args)
    preds: list[tuple[str, float, tuple]] = []
    times = []
    for name in gt:
        img = read_image(Path(args.images) / name, settings.max_image_pixels)
        t = time.perf_counter()
        dets, _ = det.predict(img, confidence=0.001)  # low threshold for the PR curve
        times.append((time.perf_counter() - t) * 1000)
        preds += [(name, d.confidence, d.bbox) for d in dets]

    thr = settings.confidence_threshold
    kept = [p for p in preds if p[1] >= thr]
    used = {k: set() for k in gt}
    tp = 0
    for name, _c, box in sorted(kept, key=lambda p: -p[1]):
        cands = [(iou(box, gbox), i) for i, gbox in enumerate(gt[name]) if i not in used[name]]
        best = max(cands, default=(0.0, -1))
        if best[0] >= 0.5:
            used[name].add(best[1])
            tp += 1
    n_gt = sum(len(v) for v in gt.values())
    result = {
        "modelVersion": det.model_version,
        "repository": det.repo_id,
        "checkpoint": det.checkpoint,
        "imageCount": len(gt),
        "groundTruthBoxes": n_gt,
        "iouThreshold": 0.5,
        "confidenceThreshold": thr,
        "precision": round(tp / max(len(kept), 1), 4),
        "recall": round(tp / max(n_gt, 1), 4),
        "mAP50": round(average_precision(preds, gt, 0.5), 4),
        "mAP50_95": round(float(np.nanmean([average_precision(preds, gt, t) for t in np.arange(0.5, 0.96, 0.05)])), 4),
        "medianInferenceMs": round(float(np.median(times)), 1),
        "device": det.state.device,
    }
    print(json.dumps(result, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
