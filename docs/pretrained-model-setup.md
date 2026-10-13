# Pretrained model selection and setup

**No model is trained or fine-tuned by this project.** The application uses published checkpoints.

## Candidates evaluated (2026-10-13)

| | `DanielsStulpe/pothole-detection` | `keremberke/yolov8n-pothole-segmentation` |
|---|---|---|
| Available | Yes | Yes |
| Checkpoint | `yolo26_best.pt` (44 MB) | `best.pt` (6.8 MB) |
| Pinned revision | `42b586f1ff38944fdd5fcc8fd6112451bbe15fb9` | `132feb1b360d9b3b5b3eed9b96add0ad42d2a026` |
| Architecture / task | YOLO26, detection (boxes) | YOLOv8n, instance segmentation (masks + boxes) |
| Classes | `{0: 'pothole'}` | `{0: 'pothole'}` |
| Licence (model card) | MIT | Not stated |
| Loads with ultralytics 8.4.176 / torch 2.14 CPU | Yes | Yes |
| Training data (per author) | Roboflow `pothole-idtb2` | `keremberke/pothole-segmentation` (Roboflow `pothole-detection-irkz9`) |

### Inference smoke test

Both models were run on the 10 held-out **test + validation** images of `keremberke/pothole-segmentation`
(CC BY 4.0, one labelled pothole per image), confidence ≥ 0.40, match at IoU ≥ 0.5, CPU:

| Model | TP | FP | FN | Precision | Recall | mAP@0.5* | Median CPU time |
|---|---|---|---|---|---|---|---|
| DanielsStulpe YOLO26 | 8 | 9 | 2 | 0.47 | 0.80 | 0.74 | ≈ 0.4–0.5 s |
| keremberke YOLOv8n-seg | 7 | 2 | 3 | 0.78 | 0.70 | — | ≈ 0.08 s |

\* from `ai-service/scripts/evaluate_model.py`.

**This is not a benchmark.** Ten images is far too few; the labels mark one pothole per image, so several
YOLO26 “false positives” are visibly other potholes in the same photo; and the images come from the same
distribution the keremberke model was trained on. No claim is made that either model is more accurate.

### Decision

**Default: `DanielsStulpe/pothole-detection` / `yolo26_best.pt`** — it is the first candidate, has an explicit
MIT licence, is described by its author as the best of their experiments, loads and runs with current
libraries, and its recall on the smoke set was higher. The **segmentation model is available** as
`DETECTOR_PRESET=keremberke-yolov8n-seg` because masks give better length/width for irregular potholes, but its
licence is unstated, so treat it as research/evaluation only until the author's terms are confirmed.

Both run with the **Ultralytics** library, which is **AGPL-3.0**. Deploying a closed-source service that uses it
requires complying with AGPL or obtaining an Ultralytics enterprise licence.

### Depth model

`depth-anything/Depth-Anything-V2-Small-hf` @ `5426e4f0f36572d16453bbda7a8389317b1bef99` (Apache-2.0), loaded through
`transformers`. MiDaS via `torch.hub` was not used because it fetches code from GitHub at runtime. Output is relative
inverse depth; see `calibration-and-measurement.md`.

## Setup

```bash
cd ai-service
py -3.12 -m venv .venv                         # Windows (python3.12 -m venv .venv on Linux/macOS)
.venv/Scripts/python -m pip install -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu
cp .env.example .env                           # set AI_SERVICE_TOKEN (same value as server/.env)
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

On first start the service downloads the pinned weights once into `model-cache/` (≈ 45 MB detector + ≈ 100 MB depth)
and loads them in the background; `/health` answers immediately and `/model/status` reports `loading`, `ready` or
`error` with the reason. Set `HF_OFFLINE=true` to forbid network access after the cache is populated.

GPU: install the CUDA build of torch/torchvision first, then set `DEVICE=cuda` (or `auto`). If CUDA is requested but
unavailable the service reports an error instead of silently falling back.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Public liveness: service, detector and depth status |
| GET | `/model/status` | Load state, device, inference count, last inference time, errors |
| GET | `/model/info` | Repository, revision, checkpoint, task, labels, thresholds, licence |
| POST | `/detect/image` | multipart: `file` **or** `path` (storage-relative), `output_dir`, `confidence`, `calibration` (JSON), `include_depth` |
| POST | `/detect/batch` | `paths` (JSON array, ≤ 50), `output_dir` |
| POST | `/detect/video` | JSON `{path, outputDir, sampleFps, maxDurationSec, confidence}` → `202 {jobId}` |
| GET | `/jobs/{id}` | Progress and result of a video job |
| POST | `/calibration/homography` | Four image points + four road-plane points → 3×3 matrix |
| POST | `/reports/pdf` | Renders a report payload computed by the API |

All endpoints except `/health` require `X-Service-Token`. Paths are resolved inside `STORAGE_DIR` and traversal is rejected.

## Replacing the checkpoint later

1. Find a Hugging Face repository whose classes include “pothole”.
2. Set in `ai-service/.env`:
   ```
   HF_REPO_ID=owner/repo
   HF_REVISION=<40-character commit hash>
   HF_CHECKPOINT=weights.pt
   ```
3. Restart the service and check `/model/info`. Existing records keep their original `modelVersion`.
4. Run `scripts/evaluate_model.py` on your own labelled local images and record the result with
   `POST /api/v1/ai/evaluations` so it appears on the AI model page and in Power BI.

Frameworks other than Ultralytics need a new loader in `app/services/detection/adapter.py`; the HTTP contract stays the same.
