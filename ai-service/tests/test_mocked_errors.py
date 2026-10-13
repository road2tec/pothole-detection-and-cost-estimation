"""MOCK tests: the detector is deliberately left unloaded to verify honest failure handling.
These do not run the model and must not be read as evidence of detection quality."""
from __future__ import annotations

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


def test_detect_returns_503_when_model_not_ready():
    app = create_app(load_models=False)
    with TestClient(app) as c:
        c.headers["X-Service-Token"] = get_settings().service_token
        ok, buf = cv2.imencode(".png", np.zeros((64, 64, 3), np.uint8))
        r = c.post("/detect/image", files={"file": ("a.png", buf.tobytes(), "image/png")})
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "MODEL_NOT_READY"
        health = c.get("/health").json()
        assert health["model"] == "not_loaded"


def test_load_failure_is_reported_not_hidden(monkeypatch):
    app = create_app(load_models=False)
    with TestClient(app) as c:
        det = app.state.detector
        monkeypatch.setattr(det, "_download", lambda: (_ for _ in ()).throw(OSError("weights missing")))
        det.load()
        c.headers["X-Service-Token"] = get_settings().service_token
        s = c.get("/model/status").json()["detector"]
        assert s["status"] == "error" and "weights missing" in s["error"]
