"""Pure unit tests (no model required)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.security import PathOutsideStorage, resolve_storage_path
from app.services.depth.estimator import sample_pothole_depth
from app.services.detection.adapter import Detection
from app.services.detection.pipeline import CalibrationInput, measure_detection
from app.services.measurement.geometry import (CalibrationError, bbox_dimensions_homography,
                                               homography_from_points, scale_from_reference, scaled_depth_m)
from app.services.video.tracker import IoUTracker, iou


# ---------------------------------------------------------------- calibration
def test_reference_scale_matches_report_worked_example():
    # Report 4.3.3: A4 long side 0.297 m spanning 180 px -> 0.00165 m/px
    s = scale_from_reference(0.297, (100, 100), (280, 100))
    assert s == pytest.approx(0.00165, rel=1e-9)
    # Report Table 4.2: 485 px x 0.00165 = 0.80 m, 364 px -> 0.60 m
    assert 485 * s == pytest.approx(0.80, abs=0.001)
    assert 364 * s == pytest.approx(0.60, abs=0.001)


@pytest.mark.parametrize("length,p2", [(0, (200, 0)), (-1, (200, 0)), (0.3, (2, 0))])
def test_reference_scale_rejects_invalid(length, p2):
    with pytest.raises(CalibrationError):
        scale_from_reference(length, (0, 0), p2)


def test_homography_maps_square_to_metres():
    img = [(100, 100), (300, 100), (300, 300), (100, 300)]
    road = [(0, 0), (2, 0), (2, 2), (0, 2)]
    h = homography_from_points(img, road)
    length, width = bbox_dimensions_homography(h, (150, 150, 250, 200))
    assert length == pytest.approx(1.0, abs=1e-6)
    assert width == pytest.approx(0.5, abs=1e-6)


def test_homography_rejects_degenerate_points():
    with pytest.raises(CalibrationError):
        homography_from_points([(0, 0), (1, 1), (2, 2), (3, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)])


def test_depth_scaling_requires_alpha_and_height():
    assert scaled_depth_m(0.1, None, 1.5) is None
    assert scaled_depth_m(0.1, 0.4, None) is None
    assert scaled_depth_m(-0.1, 0.4, 1.5) is None
    assert scaled_depth_m(0.1, 0.4, 1.5) == pytest.approx(0.06)


def test_measurement_without_calibration_is_not_converted():
    det = Detection("pothole", 0.9, (10, 10, 110, 60))
    m = measure_detection(det, None)
    assert m["lengthM"] is None and m["widthM"] is None
    assert m["bboxLengthPx"] == 100 and m["bboxWidthPx"] == 50
    assert any("Not calibrated" in s for s in m["limitations"])


def test_measurement_prefers_mask_dimensions():
    det = Detection("pothole", 0.9, (0, 0, 100, 100), mask_length_px=80, mask_width_px=40)
    m = measure_detection(det, CalibrationInput(metres_per_pixel=0.01))
    assert m["dimensionSource"] == "mask"
    assert m["lengthM"] == pytest.approx(0.8) and m["widthM"] == pytest.approx(0.4)
    box_only = measure_detection(Detection("pothole", 0.9, (0, 0, 100, 50)), CalibrationInput(metres_per_pixel=0.01))
    assert box_only["dimensionSource"] == "bbox" and box_only["lengthM"] == pytest.approx(1.0)


# ---------------------------------------------------------------- depth sampling
def test_depth_sampling_detects_dip():
    disp = np.full((200, 200), 10.0, dtype=np.float32)
    disp[80:120, 80:120] = 8.0  # farther -> smaller disparity
    s = sample_pothole_depth(disp, (75, 75, 125, 125))
    assert s.valid and s.relative_depth == pytest.approx(0.2, abs=1e-3)


def test_depth_sampling_flags_flat_or_raised_region():
    flat = np.full((200, 200), 10.0, dtype=np.float32)
    assert not sample_pothole_depth(flat, (50, 50, 100, 100)).valid
    raised = flat.copy()
    raised[60:90, 60:90] = 12.0
    assert not sample_pothole_depth(raised, (55, 55, 95, 95)).valid


# ---------------------------------------------------------------- tracking
def test_iou_basic():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1)
    assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0
    assert iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(50 / 150)


def test_tracker_links_moving_pothole_into_one_track():
    t = IoUTracker()
    for f in range(8):  # pothole drifts down and grows as the vehicle approaches
        y = 100 + f * 12
        t.update(f, f * 0.2, [((200, y, 300 + f * 3, y + 60 + f * 2), 0.5 + f * 0.05)])
    tracks = t.all_tracks()
    assert len(tracks) == 1
    assert len(tracks[0].observations) == 8
    assert tracks[0].best.confidence == pytest.approx(0.85)


def test_tracker_separates_distinct_potholes_and_survives_short_gaps():
    t = IoUTracker(max_missed=2)
    t.update(0, 0.0, [((10, 10, 60, 60), 0.6), ((400, 10, 460, 60), 0.7)])
    t.update(1, 0.2, [((12, 14, 62, 64), 0.65)])  # second pothole missed for one frame
    t.update(2, 0.4, [((14, 18, 64, 68), 0.6), ((402, 18, 462, 68), 0.75)])
    tracks = t.all_tracks()
    assert len(tracks) == 2
    assert [len(tr.observations) for tr in tracks] == [3, 2]


def test_tracker_starts_new_track_after_long_gap():
    t = IoUTracker(max_missed=1)
    t.update(0, 0, [((10, 10, 60, 60), 0.6)])
    for f in range(1, 4):
        t.update(f, f * 0.2, [])
    t.update(4, 0.8, [((10, 10, 60, 60), 0.6)])
    assert len(t.all_tracks()) == 2


# ---------------------------------------------------------------- path safety
@pytest.mark.parametrize("bad", ["../secret.txt", "..\\x", "/etc/passwd", "C:\\Windows\\win.ini", "a/../../b", ""])
def test_storage_path_traversal_rejected(bad):
    with pytest.raises(PathOutsideStorage):
        resolve_storage_path(bad)


def test_storage_path_inside_accepted():
    p = resolve_storage_path("uploads/abc/image.jpg")
    assert p.name == "image.jpg" and math.isfinite(len(str(p)))
