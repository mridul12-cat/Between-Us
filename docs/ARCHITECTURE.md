# Between Us architecture

`src/index.ts` creates the IWSDK world from the project manifest and registers `ExperienceSystem` in `src/experience.ts`. The default non-immersive view is Camera AR. The lounge uses UIKitML and the authored IWSDK scene for its immersive controls and captions.

## Camera AR

`src/ar/viewport.ts` owns the camera UI. `CameraTracking` uses a local MediaPipe Holistic worker to track one person and supply landmarks to sign recognition. The tracker, camera preview and caption placement use the same normalized video coordinates. Mirroring affects display only. Tracking loss retires the old anchor. A recognition result is associated only with the same tracked person present at capture and delivery.

## Recognition

- `src/speech/` owns microphone capture, segmentation, the Whisper worker and translation/transcription options. Recorded audio follows the same inference path and carries recorded-sample provenance.
- `src/sign/` owns timed landmark segmentation, GestureSign ONNX inference and candidate review. Camera AR shares the tracker with the sign session. The lounge can also use a bundled landmark reference clip with the camera off. The model classifies isolated signs and is limited to its vocabulary.

Both paths publish typed events through `ExperienceSystem.receive` and `CaptionCoordinator`. Captions preserve their source, recognition status and association. Camera AR automatically follows the tracked person when enabled and uses a neutral caption area otherwise. The lounge uses scene avatars or a neutral area. Demo samples carry separate provenance.

## Lifecycle and verification

Camera and microphone capture use separate controls. Leaving Camera AR stops both inputs. Device and worker operations use generation checks so stopped sessions cannot publish late recognition results. Model downloads are cacheable browser assets. The app has no persistent media recorder or offline application shell.

`npm test` covers caption coordination, camera projection, speech segmentation and runtime contracts, sign preprocessing, timing, and inference review policy. `npm run build` verifies pinned sign assets before building.
