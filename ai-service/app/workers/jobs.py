"""In-process background job registry for long-running video analysis.

Redis/Celery are not required: the Express server owns the durable job record (MongoDB) and
polls this service. If this process restarts, in-flight jobs are lost and report 'unknown';
the server then marks its job failed and it can be retried without re-uploading.
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | completed | failed | cancelled
    progress: float = 0.0
    stage: str = "Queued"
    result: dict[str, Any] | None = None
    error: str | None = None
    error_code: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    cancel_requested: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "jobId": self.id, "kind": self.kind, "status": self.status, "progress": round(self.progress, 1),
            "stage": self.stage, "error": self.error, "errorCode": self.error_code, "createdAt": self.created_at,
            "startedAt": self.started_at, "finishedAt": self.finished_at,
            "result": self.result if self.status == "completed" else None,
        }


class JobRegistry:
    def __init__(self, workers: int, retention_s: float = 3600):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="video-job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._retention = retention_s

    def submit(self, kind: str, fn: Callable[[Job], dict[str, Any]]) -> Job:
        job = Job(id=uuid.uuid4().hex, kind=kind)
        with self._lock:
            self._purge()
            self._jobs[job.id] = job

        def run() -> None:
            if job.cancel_requested:
                job.status, job.finished_at = "cancelled", time.time()
                return
            job.status, job.started_at, job.stage = "running", time.time(), "Starting"
            try:
                job.result = fn(job)
                job.status, job.progress, job.stage = "completed", 100.0, "Completed"
            except InterruptedError:
                job.status, job.stage = "cancelled", "Cancelled"
            except ValueError as exc:
                job.status, job.error, job.error_code = "failed", str(exc), "INVALID_INPUT"
            except Exception as exc:  # noqa: BLE001
                job.status, job.error, job.error_code = "failed", f"{type(exc).__name__}: {exc}", "PROCESSING_ERROR"
            finally:
                job.finished_at = time.time()

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job or job.status in ("completed", "failed", "cancelled"):
            return False
        job.cancel_requested = True
        return True

    def _purge(self) -> None:
        cutoff = time.time() - self._retention
        for jid in [j.id for j in self._jobs.values() if j.finished_at and j.finished_at < cutoff]:
            del self._jobs[jid]

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
