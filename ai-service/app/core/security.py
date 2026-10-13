"""Service-to-service authentication and safe storage path handling."""
from __future__ import annotations

import hmac
from pathlib import Path

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_service_token(x_service_token: str | None = Header(default=None)) -> None:
    expected = get_settings().service_token
    if not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing service token")


class PathOutsideStorage(ValueError):
    pass


def resolve_storage_path(relative: str, *, must_exist: bool = False) -> Path:
    """Resolve a path relative to STORAGE_DIR and refuse anything that escapes it."""
    root = get_settings().storage_dir
    if not relative or "\x00" in relative:
        raise PathOutsideStorage("Empty or invalid path")
    candidate = Path(relative)
    if candidate.is_absolute() or candidate.drive:
        raise PathOutsideStorage("Absolute paths are not accepted")
    resolved = (root / candidate).resolve()
    if resolved != root and root not in resolved.parents:
        raise PathOutsideStorage("Path escapes the storage directory")
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(relative)
    return resolved


def to_relative(path: Path) -> str:
    return path.resolve().relative_to(get_settings().storage_dir).as_posix()
