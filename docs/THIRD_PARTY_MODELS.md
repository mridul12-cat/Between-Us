# Third-party models and attribution

The Meta IWSDK scaffold is covered by its [MIT notice](IWSDK-MIT.txt).

Reviewed 17 November 2026. No model was trained or fine-tuned for Between Us. Sign inference and tracking run locally. Runtime/model assets are served from `public/sign/`, with notices in `public/sign/licenses/` (also copied into production output).

## GestureSign

- Source: [shashank11yadav/GestureSign](https://github.com/shashank11yadav/GestureSign/tree/ffc0578e68449676b6e9545da82092679914e8c8).
- Exact revision: `ffc0578e68449676b6e9545da82092679914e8c8`.
- Copyright (c) 2026 Shashank Yadav; MIT. Full notice retained in `src/sign/vendor/LICENSE` and `public/sign/licenses/GestureSign-MIT.txt`.
- Adapted only ML/tracker/worker/replay code and relevant tests, not the React website, teaching/training or prototype-store functionality. Changes: local asset prefix; isolated npm alias for ORT; TypeScript compatibility; abort/timeouts; worker failures; measured CPU tracking default; camera-frame callback cancellation; stale error suppression. Feature extraction, handedness, assembly, score calculation and explicit reference replay follow upstream. The app adds timestamp-aware live resampling, framing checks, and explicit review for uncertain candidates.
- Exact pretrained artifact: upstream `web/public/models/model.onnx`; local `public/sign/models/model.onnx`; 5,622,355 bytes; SHA-256 `2fc9038cc409a5117a3eb2bb350b005663957a03e19f24c24b1f209c703c753d`.
- Version `default-2fc9038cc4`, feature version 2, `hands_pose_lips`, ONNX opset 17, 1,395,520 parameters. Input `frames`: float32 `[1,T,460]`, 8-64 frames resampled to 30 fps. Outputs `logits` `[1,250]` and `embedding` `[1,128]`. Dynamic unpadded sequences; the exported model takes no padding mask.
- Source repository declares MIT and does not supply a separate weights-specific license. That declaration is retained as published; dataset attribution is separately retained rather than assuming MIT replaces dataset terms.
- The upstream model card is preserved verbatim as a license/provenance document in `public/sign/licenses/GestureSign-model-card-and-source-README.md`. Its intended use is vocabulary learning and demonstration, and it explicitly excludes accessibility-critical communication. Between Us is an experimental, user-confirmed prototype, not a validated interpreter or a tool for consequential decisions.
- Published held-out metrics (upstream, not independently reproduced): 72.09% top-1, 85.26% top-3, 88.08% top-5; 14,396 clips from three held-out signers. Training 70,272 clips, validation 9,809; 21 source signers. These figures are not accuracy guarantees for a webcam or this application.
- Upstream temperature `0.8826538438450513`, Not sure threshold `0.2902794036564495`. UI values are temperature-scaled classifier scores, not guarantees of correctness. `CaptionEvent.confidence` remains absent; the raw score is separately named in sign inference metadata.

## Dataset and authorized landmark replays

Google - Isolated Sign Language Recognition (Kaggle, **asl-signs**, PopSign project), [dataset source](https://www.kaggle.com/competitions/asl-signs/data), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit supplied by upstream: “Google – Isolated Sign Language Recognition (Kaggle, asl-signs), CC BY 4.0”. No endorsement is implied.

`public/sign/replay/clips.json` contains the six landmark-only held-out clips supplied by GestureSign at the pinned revision. Dataset names: blue, police, quiet, giraffe, smile, hello. No source videos or photographs are redistributed. The upstream export selects landmarks, resamples and rounds coordinates to four decimal places; Between Us preserves that file unchanged and decodes missing values to NaN in memory. SHA-256 `e3ff24f17258a0de6dfb0d13a07483b04025a3c919a73f2199f0dd633de045a3`. These are diagnostic replays, visibly labelled REPLAY, never described as new webcam input. Shared numerical feature fixtures are from the same MIT source revision.

## MediaPipe Holistic

- `@mediapipe/tasks-vision` **1.2.2**, Apache-2.0, Google. [Source/license](https://github.com/google-ai-edge/mediapipe), [Holistic documentation and component model cards](https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker).
- Pinned task asset: [Holistic float16 version 1](https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task), 13,683,609 bytes, SHA-256 `e2dab61191e2dcd0a15f943d8e3ed1dce13c82dfa597b9dd39f562975a50c3f8`. Download script validates size and digest before atomic replacement.
- The documentation links separate BlazePose GHUM, Face Mesh V2 and Hand Tracking model cards. Their Apache-2.0 declarations and limitations apply to the bundled model components; the dataset's CC BY license is a separate obligation. Full MediaPipe Apache notice is retained locally.
- Holistic outputs refined face points, pose and both hands. GestureSign deliberately copies the original 468 face indices, 21 left hand, 33 pose, 21 right hand to the training-compatible 543-point layout; extra iris points are not reindexed into it. Only selected x/y coordinates enter the classifier. Face geometry supports normalization/lips, never identity recognition. Blendshape and segmentation outputs are not requested.
- Single-person framing required. Holistic cannot reliably detect all additional people; the upstream crowd gate is not a multi-person safety guarantee.

## ONNX Runtime Web

[Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime/tree/v1.31.1), **1.31.1**, MIT, Copyright (c) Microsoft Corporation. Package alias `gesturesign-ort` isolates its single-thread WASM backend from Transformers.js's different development ORT dependency. No forced resolutions replace speech's runtime. Full MIT and ThirdPartyNotices are served locally.

## Existing speech stack

Transformers.js **4.3.2**, Apache-2.0; quantized multilingual Xenova Whisper Base/Tiny model repositories declare Apache-2.0. See [Whisper Base](https://huggingface.co/Xenova/whisper-base), [Whisper Tiny](https://huggingface.co/Xenova/whisper-tiny), [Transformers.js](https://github.com/huggingface/transformers.js).

## Reproduction and redistribution

`npm ci` installs pinned packages. `npm run sign:assets` restores/checks the pinned Holistic download and copies the exact installed runtime versions; it requires internet only if that task asset is missing or mismatched. The ONNX classifier, metadata, labels and reference replays are included locally. Keep this attribution document, the license directory and dataset credit with redistributions; do not substitute a “latest” landmarker or mismatched runtime without repeating parity and real inference verification.


## Reference playback

Sign → Try reference clip runs the first bundled held-out landmark sequence with the camera off. The review panel shows the dataset credit and reference origin, and the resulting caption preserves reference provenance. Explicit confirmation is required. The local input audio picker hands decoded samples to Whisper, and captions identify that recorded origin. Local benchmark voices remain in the ignored fixture folder and do not ship with the application. Use consented or appropriately licensed audio in any public video.
