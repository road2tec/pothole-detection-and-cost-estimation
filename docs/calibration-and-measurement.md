# Calibration and measurement

The system never converts pixels to metres without explicit calibration, and never assumes a camera height or angle.

## Measurement status of a pothole

| Status | Meaning | Shown |
|---|---|---|
| `not_calibrated` | No reference calibration and no applicable camera profile | Detection only; size, volume, cost “Not calibrated” |
| `depth_unavailable` | Length and width known, no depth in metres (or depth withheld as implausible) | L × W; volume and cost unavailable |
| `complete` | L, W and D known and valid | Volume, severity, cost |
| `invalid` | Inputs failed validation (e.g. absurd values) | Flagged for review |

## 1. Reference-object calibration (per image)

The user clicks the two ends of an object of known length lying on the road near the pothole (A4 long side
0.297 m, A4 short side 0.21 m, 30 cm ruler, 1 m rod, or custom). Coordinates can also be typed.

```
scale (m/px) = reference length / pixel distance between the two points      (report Eq. 4.3)
L = length_px × scale,  W = width_px × scale                                  (report Eq. 4.4)
```

* `length_px`/`width_px` come from the segmentation mask's minimum-area rectangle when the model provides masks
  (`dimensionSource = mask`), otherwise from the bounding box (`max(w,h)`, `min(w,h)`, `dimensionSource = bbox`).
  Bounding boxes overestimate irregular potholes.
* Points closer than 5 px are rejected; under 30 px the UI warns that click error dominates.
* A scale is valid only near the reference object's plane and distance — perspective makes farther potholes smaller.
* Stored: reference label and length, both points, pixel length, scale, image size, user, time, review status.
  A new calibration supersedes the previous one (kept in history); engineers can approve or reject a calibration,
  and rejection reverts the image's potholes to “Not calibrated”.

## 2. Camera profiles (fixed mounts)

Administrators define profiles only for surveyed set-ups:

* **Fixed scale** — metres per pixel measured for that mounting at a reference resolution (e.g. a top-down camera
  at fixed height).
* **Homography** — four image points of known road-plane positions (e.g. corners of a painted 2 m × 4 m rectangle).
  The AI service computes the 3×3 matrix (report Eq. 4.5); the server maps the four bounding-box corners onto the
  road plane and averages opposite sides. This assumes a flat road.

A profile with a reference resolution is **not applied** to images of another resolution (flag
`profile_resolution_mismatch`). Editing a profile re-measures every upload that uses it.

## 3. Depth

The pretrained depth model returns relative inverse depth (disparity, no unit, scale varies per image). For each
detection the AI service samples:

* `d_road` = median disparity in a ring 25 % wider than the box (intact road),
* `d_pit` = mean disparity of the 20 % farthest pixels inside the box,

and reports `relative_depth = (d_road − d_pit) / d_road` (dimensionless; normalising by `d_road` removes the
per-image scale). If the pothole does not appear deeper than the road, the sample is marked invalid.

Depth in metres follows report Eq. 4.6 **only when a camera profile supplies both**:

```
D = α × relative_depth × Z
```

where `Z` is the camera height and `α` is a factor fitted against hand-measured depths for that camera
(`depthAlphaNote` must say how). No default α exists, so out of the box depth is “relative only” and users enter a
measured depth. Model-scaled depths above the plausibility limit (default 0.5 m, report §3.4.2) are flagged
`depth_implausible`, excluded from volume and cost, and sent for review.

### Fitting α (recommended procedure)

1. For one fixed camera set-up, photograph ≥ 20 potholes and measure each maximum depth with a ruler.
2. Upload them with the camera profile (without α) and note each pothole's `depthRelative`.
3. Fit `α = Σ(Dᵢ · rᵢ · Z) / Σ(rᵢ · Z)²` (least squares through the origin) and report the MAPE.
4. Save α and a note (“24 potholes, tape-measured, MAPE 31 %”) on the profile.

## 4. Manual measurements

Inspectors (before review) and engineers can enter length/width and/or depth with a mandatory reason. Manual values
are marked `manual`, survive recalibration, appear in reports as “entered manually”, and can be reverted.
Validation rejects non-positive, non-finite or absurd values (L, W ≤ 20 m; D ≤ 2 m; L ≥ W).

## Provenance shown everywhere

Each value carries its source: bounding box × scale, mask × scale, homography, model-scaled depth, or manual.
The PDF report prints these with notes for uncalibrated and manually reviewed records.
