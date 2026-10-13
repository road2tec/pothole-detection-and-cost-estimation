"""Runtime configuration for the AI microservice (environment variables / ai-service/.env)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SERVICE_ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVICE_ROOT / ".env", extra="ignore")

    # Shared secret sent by the Express server in the X-Service-Token header.
    service_token: str = Field(min_length=16, alias="AI_SERVICE_TOKEN")

    storage_dir: Path = Field(default=REPO_ROOT / "storage", alias="STORAGE_DIR")
    model_cache_dir: Path = Field(default=REPO_ROOT / "model-cache", alias="MODEL_CACHE_DIR")

    # Detector selection. A preset fills in repository, revision and checkpoint; any explicit
    # HF_* variable overrides the preset so the checkpoint can be replaced without code changes.
    detector_preset: str = Field(default="daniels-yolo26", alias="DETECTOR_PRESET")
    hf_repo_id: str | None = Field(default=None, alias="HF_REPO_ID")
    hf_revision: str | None = Field(default=None, alias="HF_REVISION")
    hf_checkpoint: str | None = Field(default=None, alias="HF_CHECKPOINT")
    hf_offline: bool = Field(default=False, alias="HF_OFFLINE")

    confidence_threshold: float = Field(default=0.40, ge=0.01, le=0.99, alias="CONFIDENCE_THRESHOLD")
    iou_threshold: float = Field(default=0.50, ge=0.05, le=0.95, alias="IOU_THRESHOLD")
    inference_image_size: int = Field(default=640, ge=320, le=1920, alias="INFERENCE_IMAGE_SIZE")
    device: str = Field(default="cpu", alias="DEVICE")  # "cpu", "cuda", "cuda:0" or "auto"
    inference_timeout_s: float = Field(default=60.0, gt=0, alias="INFERENCE_TIMEOUT_S")

    depth_enabled: bool = Field(default=True, alias="DEPTH_ENABLED")
    depth_repo_id: str = Field(default="depth-anything/Depth-Anything-V2-Small-hf", alias="DEPTH_REPO_ID")
    depth_revision: str | None = Field(default="5426e4f0f36572d16453bbda7a8389317b1bef99", alias="DEPTH_REVISION")

    video_max_duration_s: float = Field(default=600, gt=0, alias="VIDEO_MAX_DURATION_S")
    video_default_sample_fps: float = Field(default=5.0, gt=0, le=30, alias="VIDEO_SAMPLE_FPS")
    video_workers: int = Field(default=1, ge=1, le=4, alias="VIDEO_WORKERS")

    max_image_pixels: int = Field(default=40_000_000, alias="MAX_IMAGE_PIXELS")

    @field_validator("storage_dir", "model_cache_dir")
    @classmethod
    def _absolute(cls, v: Path) -> Path:
        return v.resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
