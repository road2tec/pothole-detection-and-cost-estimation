"""FastAPI entry point: `uvicorn app.main:app --port 8000`."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import public, router
from app.core.config import get_settings
from app.services.depth.estimator import DepthEstimator
from app.services.detection.adapter import PotholeDetector
from app.workers.jobs import JobRegistry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(load_models: bool = True) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.storage_dir.mkdir(parents=True, exist_ok=True)
        app.state.detector = PotholeDetector(settings)
        app.state.depth = DepthEstimator(settings)
        app.state.jobs = JobRegistry(settings.video_workers)
        if load_models:
            # Load in the background so /health answers immediately while weights download.
            def _load() -> None:
                app.state.detector.load()
                app.state.depth.load()

            threading.Thread(target=_load, name="model-loader", daemon=True).start()
        yield
        app.state.jobs.shutdown()

    app = FastAPI(title="Pothole AI Service", version="1.0.0", lifespan=lifespan)
    app.include_router(public)
    app.include_router(router)
    return app


app = create_app()
