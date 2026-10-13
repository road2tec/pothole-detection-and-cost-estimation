from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class CalibrationModel(BaseModel):
    metresPerPixel: float | None = Field(default=None, gt=0, lt=1)
    homography: list[float] | None = None
    depthAlpha: float | None = Field(default=None, gt=0)
    cameraHeightM: float | None = Field(default=None, gt=0, lt=50)

    @field_validator("homography")
    @classmethod
    def _nine(cls, v: list[float] | None) -> list[float] | None:
        if v is not None and len(v) != 9:
            raise ValueError("homography must have 9 values")
        return v


class VideoJobRequest(BaseModel):
    path: str
    outputDir: str
    sampleFps: float | None = Field(default=None, gt=0, le=30)
    maxDurationSec: float | None = Field(default=None, gt=0)
    confidence: float | None = Field(default=None, ge=0.01, le=0.99)
    calibration: CalibrationModel | None = None


class Point(BaseModel):
    x: float
    y: float


class HomographyRequest(BaseModel):
    imagePoints: list[Point] = Field(min_length=4, max_length=4)
    roadPointsM: list[Point] = Field(min_length=4, max_length=4)


class PdfReportRequest(BaseModel):
    outputPath: str
    payload: dict
