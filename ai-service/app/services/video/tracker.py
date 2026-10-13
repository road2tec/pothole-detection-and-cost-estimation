"""Lightweight multi-object tracker for cross-frame duplicate suppression.

Detections in consecutive sampled frames are linked to existing tracks by IoU against each
track's constant-velocity predicted box (greedy, highest IoU first). Each track represents one
physical pothole; only its best (highest-confidence) observation is kept as the pothole record.
"""
from __future__ import annotations

from dataclasses import dataclass, field

Box = tuple[float, float, float, float]


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Observation:
    frame_index: int
    time_sec: float
    bbox: Box
    confidence: float


@dataclass
class Track:
    track_id: int
    observations: list[Observation] = field(default_factory=list)
    missed: int = 0
    velocity: tuple[float, float] = (0.0, 0.0)

    @property
    def last(self) -> Observation:
        return self.observations[-1]

    @property
    def best(self) -> Observation:
        return max(self.observations, key=lambda o: o.confidence)

    def predicted_box(self) -> Box:
        x1, y1, x2, y2 = self.last.bbox
        dx, dy = self.velocity
        steps = self.missed + 1
        return (x1 + dx * steps, y1 + dy * steps, x2 + dx * steps, y2 + dy * steps)

    def add(self, obs: Observation) -> None:
        if self.observations:
            p = self.last.bbox
            gap = max(1, self.missed + 1)
            cx_prev, cy_prev = (p[0] + p[2]) / 2, (p[1] + p[3]) / 2
            cx, cy = (obs.bbox[0] + obs.bbox[2]) / 2, (obs.bbox[1] + obs.bbox[3]) / 2
            nv = ((cx - cx_prev) / gap, (cy - cy_prev) / gap)
            # Smooth velocity to avoid jitter from box noise.
            self.velocity = (0.5 * self.velocity[0] + 0.5 * nv[0], 0.5 * self.velocity[1] + 0.5 * nv[1])
        self.observations.append(obs)
        self.missed = 0


class IoUTracker:
    def __init__(self, iou_threshold: float = 0.2, max_missed: int = 3):
        self.iou_threshold = iou_threshold
        self.max_missed = max_missed
        self.active: list[Track] = []
        self.finished: list[Track] = []
        self._next_id = 1

    def update(self, frame_index: int, time_sec: float, detections: list[tuple[Box, float]]) -> list[int]:
        """Feed one sampled frame. Returns the track id assigned to each detection."""
        pairs = []
        for ti, track in enumerate(self.active):
            pred = track.predicted_box()
            for di, (box, _) in enumerate(detections):
                score = max(iou(pred, box), iou(track.last.bbox, box))
                if score >= self.iou_threshold:
                    pairs.append((score, ti, di))
        pairs.sort(reverse=True)
        used_t, used_d = set(), set()
        assigned: dict[int, int] = {}
        for _, ti, di in pairs:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            box, conf = detections[di]
            self.active[ti].add(Observation(frame_index, time_sec, box, conf))
            assigned[di] = self.active[ti].track_id
        for ti, track in enumerate(self.active):
            if ti not in used_t:
                track.missed += 1
        for di, (box, conf) in enumerate(detections):
            if di in used_d:
                continue
            track = Track(self._next_id)
            self._next_id += 1
            track.add(Observation(frame_index, time_sec, box, conf))
            self.active.append(track)
            assigned[di] = track.track_id
        still = []
        for track in self.active:
            (self.finished if track.missed > self.max_missed else still).append(track)
        self.active = still
        return [assigned[i] for i in range(len(detections))]

    def all_tracks(self) -> list[Track]:
        return sorted(self.finished + self.active, key=lambda t: t.track_id)
