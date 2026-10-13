"""HTTP API for the AI microservice. All routes except /health require X-Service-Token."""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import PathOutsideStorage, require_service_token, resolve_storage_path
from app.schemas.requests import CalibrationModel, HomographyRequest, PdfReportRequest, VideoJobRequest
from app.services.detection.adapter import ModelNotReady
from app.services.detection.annotate import InvalidImage, decode_image, read_image
from app.services.detection.pipeline import CalibrationInput, run_image
from app.services.measurement.geometry import CalibrationError, homography_from_points
from app.services.reporting.pdf import render_report
from app.services.video.processor import InvalidVideo, process_video

public = APIRouter()
router = APIRouter(dependencies=[Depends(require_service_token)])


def _state(request: Request) -> Any:
    return request.app.state


def _calibration(raw: str | None) -> CalibrationInput | None:
    if not raw:
        return None
    try:
        c = CalibrationModel.model_validate_json(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Invalid calibration: {exc}") from exc
    return CalibrationInput(c.metresPerPixel, c.homography, c.depthAlpha, c.cameraHeightM)


def _safe_path(rel: str, must_exist: bool = False) -> Path:
    try:
        return resolve_storage_path(rel, must_exist=must_exist)
    except PathOutsideStorage as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"File not found: {rel}") from exc


def _require_ready(request: Request) -> None:
    det = _state(request).detector
    if not det.state.status == "ready":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            {"code": "MODEL_NOT_READY", "status": det.state.status, "error": det.state.error})


@public.get("/health")
def health(request: Request) -> dict[str, Any]:
    st = _state(request)
    return {
        "status": "ok",
        "service": "pothole-ai-service",
        "model": st.detector.state.status,
        "depth": st.depth.status,
    }


@router.get("/model/status")
def model_status(request: Request) -> dict[str, Any]:
    st = _state(request)
    return {"detector": st.detector.status(), "depth": st.depth.info()}


@router.get("/model/info")
def model_info(request: Request) -> dict[str, Any]:
    st = _state(request)
    return {"detector": st.detector.info(), "depth": st.depth.info()}


async def _detect_one(request: Request, image, out_dir: Path, stem: str, confidence: float | None,
                      calib: CalibrationInput | None, include_depth: bool) -> dict[str, Any]:
    st = _state(request)
    timeout = get_settings().inference_timeout_s
    try:
        return await asyncio.wait_for(
            run_in_threadpool(run_image, image, st.detector, st.depth, out_dir, stem, confidence, calib, include_depth),
            timeout=timeout,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, f"Inference exceeded {timeout:.0f}s") from exc
    except ModelNotReady as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"code": "MODEL_NOT_READY", "error": str(exc)}) from exc


@router.post("/detect/image")
async def detect_image(
    request: Request,
    file: UploadFile | None = File(default=None),
    path: str | None = Form(default=None),
    output_dir: str | None = Form(default=None),
    confidence: float | None = Form(default=None, ge=0.01, le=0.99),
    calibration: str | None = Form(default=None),
    include_depth: bool = Form(default=True),
) -> dict[str, Any]:
    """Detect potholes in one image, given either an uploaded file or a storage-relative path."""
    _require_ready(request)
    settings = get_settings()
    if (file is None) == (path is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provide exactly one of 'file' or 'path'")
    try:
        if path is not None:
            src = _safe_path(path, must_exist=True)
            image = await run_in_threadpool(read_image, src, settings.max_image_pixels)
            stem = src.stem
        else:
            data = await file.read()  # type: ignore[union-attr]
            image = decode_image(data, settings.max_image_pixels)
            stem = uuid.uuid4().hex[:12]
    except InvalidImage as exc:
        raise HTTPException(422, str(exc)) from exc
    out_dir = _safe_path(output_dir or f"ai-standalone/{stem}")
    return await _detect_one(request, image, out_dir, stem, confidence, _calibration(calibration), include_depth)


@router.post("/detect/batch")
async def detect_batch(
    request: Request,
    paths: str = Form(..., description="JSON array of storage-relative image paths"),
    output_dir: str = Form(...),
    confidence: float | None = Form(default=None, ge=0.01, le=0.99),
    include_depth: bool = Form(default=False),
) -> dict[str, Any]:
    _require_ready(request)
    settings = get_settings()
    try:
        items = json.loads(paths)
        assert isinstance(items, list) and all(isinstance(p, str) for p in items)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "'paths' must be a JSON array of strings") from exc
    if not 1 <= len(items) <= 50:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Between 1 and 50 images per batch")
    out_dir = _safe_path(output_dir)
    results = []
    for rel in items:
        try:
            src = _safe_path(rel, must_exist=True)
            image = await run_in_threadpool(read_image, src, settings.max_image_pixels)
            r = await _detect_one(request, image, out_dir, src.stem, confidence, None, include_depth)
            results.append({"path": rel, "ok": True, "result": r})
        except HTTPException as exc:
            results.append({"path": rel, "ok": False, "error": exc.detail})
        except InvalidImage as exc:
            results.append({"path": rel, "ok": False, "error": str(exc)})
    return {"count": len(results), "results": results}


@router.post("/detect/video", status_code=status.HTTP_202_ACCEPTED)
def detect_video(request: Request, body: VideoJobRequest) -> dict[str, Any]:
    """Queue a background video job. Poll GET /jobs/{jobId} for progress and results."""
    _require_ready(request)
    st = _state(request)
    settings = get_settings()
    src = _safe_path(body.path, must_exist=True)
    out_dir = _safe_path(body.outputDir)
    calib = None
    if body.calibration:
        c = body.calibration
        calib = CalibrationInput(c.metresPerPixel, c.homography, c.depthAlpha, c.cameraHeightM)
    sample_fps = body.sampleFps or settings.video_default_sample_fps
    max_dur = min(body.maxDurationSec or settings.video_max_duration_s, settings.video_max_duration_s)

    def work(job) -> dict[str, Any]:  # noqa: ANN001
        def progress(pct: float, stage: str) -> None:
            job.progress, job.stage = pct, stage

        try:
            return process_video(src, st.detector, out_dir, sample_fps, max_dur, body.confidence, calib, progress,
                                 lambda: job.cancel_requested)
        except InvalidVideo as exc:
            raise ValueError(str(exc)) from exc

    job = st.jobs.submit("video", work)
    return {"jobId": job.id, "status": job.status}


@router.get("/jobs/{job_id}")
def job_status(request: Request, job_id: str) -> dict[str, Any]:
    job = _state(request).jobs.get(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "JOB_UNKNOWN", "error": "Job not found (expired or service restarted)"})
    return job.public()


@router.post("/jobs/{job_id}/cancel")
def job_cancel(request: Request, job_id: str) -> dict[str, Any]:
    return {"cancelled": _state(request).jobs.cancel(job_id)}


@router.post("/calibration/homography")
def calibration_homography(body: HomographyRequest) -> dict[str, Any]:
    try:
        h = homography_from_points([(p.x, p.y) for p in body.imagePoints], [(p.x, p.y) for p in body.roadPointsM])
    except CalibrationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"homography": h}


@router.post("/reports/pdf")
async def reports_pdf(body: PdfReportRequest) -> dict[str, Any]:
    _safe_path(body.outputPath)
    try:
        return await run_in_threadpool(render_report, body.payload, body.outputPath)
    except PathOutsideStorage as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
