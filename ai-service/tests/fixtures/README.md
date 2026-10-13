# Test fixtures

`images/` holds 10 real road photographs (640×640) and their ground-truth boxes (`gt.json`, COCO
`[x, y, w, h]`). They are the **test** and **validation** splits of the Hugging Face dataset
[`keremberke/pothole-segmentation`](https://huggingface.co/datasets/keremberke/pothole-segmentation),
exported from Roboflow Universe project
[`pothole-detection-irkz9` v4](https://universe.roboflow.com/imacs-pothole-detection-wo8mu/pothole-detection-irkz9/dataset/4)
(licence: CC BY 4.0).

The images are used only for inference smoke tests. Nothing in this project trains on them.

Note that the `keremberke/yolov8n-pothole-segmentation` model was trained on the *train* split of the same
dataset. These splits are held out from that training, but they come from the same distribution, so results
on them are optimistic for that model and are not a general accuracy benchmark.
