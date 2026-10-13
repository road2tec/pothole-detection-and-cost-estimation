"""Genuine inference tests: these load the real pretrained checkpoint and run it on real road
photographs (tests/fixtures/images, CC BY 4.0, see tests/fixtures/README.md). No model output is
mocked here. They are skipped only if the weights cannot be loaded (e.g. offline with no cache).
"""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures" / "images"
TEST_DIR = "pytest-run"


@pytest.fixture(scope="module")
def client():
    app = create_app(load_models=False)
    with TestClient(app) as c:
        app.state.detector.load()
        if app.state.detector.state.status != "ready":
            pytest.skip(f"Model unavailable: {app.state.detector.state.error}")
        # Depth is optional for these tests; load it only if cached weights exist.
        app.state.depth.load()
        settings = get_settings()
        work = settings.storage_dir / TEST_DIR
        work.mkdir(parents=True, exist_ok=True)
        for f in FIXTURES.glob("*.jpg"):
            shutil.copy(f, work / f.name)
        c.headers["X-Service-Token"] = settings.service_token
        yield c
        shutil.rmtree(work, ignore_errors=True)


def test_requires_service_token(client):
    r = client.get("/model/status", headers={"X-Service-Token": "wrong-token-value-123"})
    assert r.status_code == 401


def test_model_status_and_info(client):
    s = client.get("/model/status").json()
    assert s["detector"]["ready"] is True
    info = client.get("/model/info").json()["detector"]
    assert info["revisionPinned"] is True
    assert "pothole" in [x.lower() for x in info["classLabels"]]
    assert info["trainedByThisProject"] is False


def test_detects_pothole_in_real_photo(client):
    r = client.post("/detect/image", data={"path": f"{TEST_DIR}/test_1.jpg", "output_dir": f"{TEST_DIR}/out"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detectionCount"] >= 1
    d = body["detections"][0]
    assert d["label"].lower() == "pothole"
    assert 0.40 <= d["confidence"] <= 1
    assert d["bbox"]["x2"] > d["bbox"]["x1"] and d["bbox"]["y2"] > d["bbox"]["y1"]
    assert body["modelVersion"].startswith(get_settings().hf_repo_id or "")
    assert (get_settings().storage_dir / body["annotatedPath"]).is_file()
    assert (get_settings().storage_dir / d["cropPath"]).is_file()
    # Without calibration no physical dimensions may be produced.
    assert d["measurement"]["lengthM"] is None


def test_multiple_detections_sorted_by_confidence(client):
    counts = {}
    for name in ["test_0.jpg", "test_2.jpg", "validation_1.jpg"]:
        body = client.post("/detect/image", data={"path": f"{TEST_DIR}/{name}", "output_dir": f"{TEST_DIR}/out",
                                                  "include_depth": "false"}).json()
        confs = [d["confidence"] for d in body["detections"]]
        assert confs == sorted(confs, reverse=True)
        counts[name] = len(confs)
    assert max(counts.values()) >= 2, counts


def test_confidence_threshold_filters(client):
    low = client.post("/detect/image", data={"path": f"{TEST_DIR}/test_2.jpg", "output_dir": f"{TEST_DIR}/out",
                                             "confidence": "0.40", "include_depth": "false"}).json()
    high = client.post("/detect/image", data={"path": f"{TEST_DIR}/test_2.jpg", "output_dir": f"{TEST_DIR}/out",
                                              "confidence": "0.90", "include_depth": "false"}).json()
    assert high["detectionCount"] <= low["detectionCount"]
    assert all(d["confidence"] >= 0.90 for d in high["detections"])


def test_genuine_empty_result_on_blank_image(client):
    blank = np.full((480, 640, 3), 128, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", blank)
    r = client.post("/detect/image", files={"file": ("blank.png", buf.tobytes(), "image/png")},
                    data={"output_dir": f"{TEST_DIR}/out"})
    assert r.status_code == 200
    assert r.json()["detectionCount"] == 0
    assert r.json()["detections"] == []


def test_invalid_image_rejected(client):
    r = client.post("/detect/image", files={"file": ("x.jpg", b"not an image", "image/jpeg")},
                    data={"output_dir": f"{TEST_DIR}/out"})
    assert r.status_code == 422


def test_path_traversal_rejected_by_api(client):
    r = client.post("/detect/image", data={"path": "../server/.env", "output_dir": f"{TEST_DIR}/out"})
    assert r.status_code == 400


def test_calibrated_detection_returns_metric_dimensions(client):
    calib = json.dumps({"metresPerPixel": 0.00165})
    body = client.post("/detect/image", data={"path": f"{TEST_DIR}/test_1.jpg", "output_dir": f"{TEST_DIR}/out",
                                              "calibration": calib, "include_depth": "false"}).json()
    m = body["detections"][0]["measurement"]
    expected = (m["maskLengthPx"] or m["bboxLengthPx"]) * 0.00165
    assert m["lengthM"] == pytest.approx(expected, abs=1e-3)
    assert m["dimensionSource"] in ("bbox", "mask")


def test_depth_is_relative_without_alpha(client):
    if not client.app.state.depth.ready:
        pytest.skip("Depth model not available")
    body = client.post("/detect/image", data={"path": f"{TEST_DIR}/test_1.jpg", "output_dir": f"{TEST_DIR}/out",
                                              "calibration": json.dumps({"metresPerPixel": 0.00165})}).json()
    depth = body["detections"][0]["depth"]
    assert depth["status"] == "ok"
    assert depth["depthM"] is None  # no fitted alpha / camera height -> no metres
    assert depth["reason"]


def test_video_duplicate_suppression(client):
    """A synthetic pan across a real pothole photo: many frame-level detections, few unique tracks."""
    settings = get_settings()
    src = cv2.imread(str(FIXTURES / "test_1.jpg"))
    h, w = src.shape[:2]
    canvas_h = h + 160
    video_path = settings.storage_dir / TEST_DIR / "pan.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (w, h))
    for f in range(30):  # 3 s at 10 fps; the road "moves" downward like a forward-facing camera
        canvas = np.full((canvas_h, w, 3), 90, dtype=np.uint8)
        canvas[0:h] = src
        offset = 160 - int(f * 160 / 29)
        writer.write(canvas[offset:offset + h] if offset + h <= canvas_h else canvas[:h])
    writer.release()

    r = client.post("/detect/video", json={"path": f"{TEST_DIR}/pan.mp4", "outputDir": f"{TEST_DIR}/video",
                                           "sampleFps": 5})
    assert r.status_code == 202, r.text
    job_id = r.json()["jobId"]
    deadline = time.time() + 120
    job = {}
    while time.time() < deadline:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            break
        time.sleep(0.5)
    assert job["status"] == "completed", job
    res = job["result"]
    assert res["sampledFrames"] == 15
    assert res["frameLevelDetections"] >= res["uniqueTracks"] >= 1
    assert res["frameLevelDetections"] > res["uniqueTracks"], "duplicates across frames must be merged"
    best = res["tracks"][0]["best"]
    assert (settings.storage_dir / best["framePath"]).is_file()


def test_unknown_job_404(client):
    assert client.get("/jobs/does-not-exist").status_code == 404


def test_pdf_report_renders(client):
    payload = {"title": "Test report", "meta": {"generatedBy": "pytest"},
               "totals": {"potholes": 1, "estimatedBudget": 1201.2},
               "severity": [{"severity": "moderate", "count": 1, "variableCost": 701.2}],
               "costConfig": {"version": 1, "materialPerM3": 25000, "labourPerM3": 6000, "mobilisationPerVisit": 500,
                              "minorMaxM3": 0.005, "severeMinM3": 0.03, "isPrototypeDefault": True},
               "potholes": [{"code": "PH-1", "lengthM": 0.8, "widthM": 0.6, "depthM": 0.06, "volumeM3": 0.0226,
                             "cropPath": f"{TEST_DIR}/test_1.jpg", "severity": "moderate"}]}
    r = client.post("/reports/pdf", json={"outputPath": f"{TEST_DIR}/report.pdf", "payload": payload})
    assert r.status_code == 200, r.text
    assert (get_settings().storage_dir / TEST_DIR / "report.pdf").read_bytes()[:4] == b"%PDF"
