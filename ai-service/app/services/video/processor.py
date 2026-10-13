"""Survey-video processing: frame sampling, per-frame inference, tracking, best-frame selection."""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from app.core.security import to_relative
from app.services.detection.adapter import Detection, PotholeDetector
from app.services.detection.annotate import crop, draw_detections, write_jpeg
from app.services.detection.pipeline import CalibrationInput, measure_detection
from app.services.video.tracker import IoUTracker


class InvalidVideo(ValueError):
    pass


@dataclass
class VideoProbe:
    fps: float
    frame_count: int
    duration_s: float
    width: int
    height: int


def probe_video(path: Path) -> VideoProbe:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise InvalidVideo("Video could not be opened (unsupported codec or corrupt file)")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if fps <= 0 or fps > 240 or count <= 0 or w <= 0 or h <= 0:
            raise InvalidVideo("Video metadata is missing or invalid")
        return VideoProbe(fps=fps, frame_count=count, duration_s=count / fps, width=w, height=h)
    finally:
        cap.release()


ProgressFn = Callable[[float, str], None]


def process_video(
    path: Path,
    detector: PotholeDetector,
    out_dir: Path,
    sample_fps: float,
    max_duration_s: float,
    confidence: float | None,
    calib: CalibrationInput | None,
    progress: ProgressFn,
    should_cancel: Callable[[], bool] = lambda: False,
) -> dict[str, Any]:
    probe = probe_video(path)
    if probe.duration_s > max_duration_s:
        raise InvalidVideo(f"Video is {probe.duration_s:.0f}s long; the limit is {max_duration_s:.0f}s")
    step = max(1, round(probe.fps / sample_fps))
    tracker = IoUTracker()
    # Keep the frame for each track's current best observation (encoded to limit memory).
    best_frames: dict[int, tuple[float, bytes, Detection]] = {}
    frame_results: list[dict[str, Any]] = []
    sampled = 0
    total_detections = 0
    inference_ms_total = 0.0
    started = time.perf_counter()
    expected_samples = max(1, math.ceil(probe.frame_count / step))

    cap = cv2.VideoCapture(str(path))
    try:
        index = -1
        while True:
            ok = cap.grab()
            if not ok:
                break
            index += 1
            if index % step:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            if should_cancel():
                raise InterruptedError("Job cancelled")
            t = index / probe.fps
            dets, ms = detector.predict(frame, confidence)
            inference_ms_total += ms
            sampled += 1
            total_detections += len(dets)
            ids = tracker.update(index, t, [(d.bbox, d.confidence) for d in dets])
            for det, tid in zip(dets, ids):
                prev = best_frames.get(tid)
                if prev is None or det.confidence > prev[0]:
                    ok_enc, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                    if ok_enc:
                        best_frames[tid] = (det.confidence, buf.tobytes(), det)
            frame_results.append({"frameIndex": index, "timeSec": round(t, 3), "detections": len(dets),
                                  "trackIds": ids})
            progress(min(99.0, 100.0 * sampled / expected_samples), f"Analysed {sampled} of ~{expected_samples} frames")
    finally:
        cap.release()

    out_dir.mkdir(parents=True, exist_ok=True)
    tracks_out = []
    for track in tracker.all_tracks():
        best = track.best
        entry = best_frames.get(track.track_id)
        if entry is None:
            continue
        _, jpg, det = entry
        frame = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
        stem = f"track_{track.track_id:04d}"
        frame_path = out_dir / f"{stem}_frame.jpg"
        annotated_path = out_dir / f"{stem}_annotated.jpg"
        crop_path = out_dir / f"{stem}_crop.jpg"
        write_jpeg(frame_path, frame)
        write_jpeg(annotated_path, draw_detections(frame, [det], [f"track {track.track_id} {det.confidence:.2f}"]))
        write_jpeg(crop_path, crop(frame, det.bbox))
        tracks_out.append({
            "trackId": track.track_id,
            "observationCount": len(track.observations),
            "firstTimeSec": round(track.observations[0].time_sec, 3),
            "lastTimeSec": round(track.observations[-1].time_sec, 3),
            "best": {
                "frameIndex": best.frame_index,
                "timeSec": round(best.time_sec, 3),
                "confidence": round(best.confidence, 4),
                "label": det.label,
                "bbox": {"x1": round(det.bbox[0], 1), "y1": round(det.bbox[1], 1),
                         "x2": round(det.bbox[2], 1), "y2": round(det.bbox[3], 1)},
                "maskPolygon": det.mask_polygon,
                "measurement": measure_detection(det, calib),
                "framePath": to_relative(frame_path),
                "annotatedPath": to_relative(annotated_path),
                "cropPath": to_relative(crop_path),
            },
            "observations": [
                {"frameIndex": o.frame_index, "timeSec": round(o.time_sec, 3), "confidence": round(o.confidence, 4),
                 "bbox": {"x1": round(o.bbox[0], 1), "y1": round(o.bbox[1], 1),
                          "x2": round(o.bbox[2], 1), "y2": round(o.bbox[3], 1)}}
                for o in track.observations
            ],
        })
    progress(100.0, "Completed")
    return {
        "video": {"fps": round(probe.fps, 3), "frameCount": probe.frame_count, "durationSec": round(probe.duration_s, 2),
                  "width": probe.width, "height": probe.height},
        "sampleFps": sample_fps,
        "frameStep": step,
        "sampledFrames": sampled,
        "frameLevelDetections": total_detections,
        "uniqueTracks": len(tracks_out),
        "tracks": tracks_out,
        "frames": frame_results,
        "inferenceMsTotal": round(inference_ms_total, 1),
        "processingSeconds": round(time.perf_counter() - started, 2),
        "modelVersion": detector.model_version,
        "imageWidth": probe.width,
        "imageHeight": probe.height,
    }
