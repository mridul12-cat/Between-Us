# Between Us contributor guide

## Working locally

- Use a Node.js version supported by `package.json`. The local default is in `.nvmrc`.
- Run `npm ci` and `npm run dev` to start the IWSDK-managed runtime. Use `npm run dev:status` to check readiness and `npm run dev:down` to stop it.
- Run `npm run typecheck`, `npm test`, and `npm run build` after application changes. The production build verifies the pinned sign assets before compiling.
- Browser camera and microphone access requires HTTPS or localhost. For camera-free verification, open Camera AR without starting capture or use the bundled reference clip in the lounge. Label recorded and reference inputs in any screenshots or test reports.

## Application boundaries

- `iwsdk.config.json` defines the IWSDK world. Keep `src/index.ts` wired to `virtual:iwsdk-project`. Import Three.js APIs from `@iwsdk/core`.
- Camera AR is the default browser view. `src/ar/` handles the viewport, person tracking and caption placement. The lounge and immersive interfaces use the authored scene and UIKitML panels in `public/scenes/` and `public/ui/`. Keep the asset and component manifests free of runtime side effects.
- `src/speech/` and `src/sign/` handle local inference. Route caption events through `ExperienceSystem` and `CaptionCoordinator` and preserve input provenance. Keep demo content, reference replays and live recognition distinguishable.
- Capture starts through explicit controls and stops when leaving the camera view. Camera AR attaches new captions only to the same active track from capture through delivery. Preserve neutral fallback and explicit confirmation for uncertain sign proposals.
- Keep model versions, checksums and attribution in sync if model assets change. See [the architecture](docs/ARCHITECTURE.md) and [third-party notices](docs/THIRD_PARTY_MODELS.md).

## Git and hosting

Keep generated outputs, model caches and private fixtures outside Git. Use `docs/screenshots/` for curated README images. The Vercel configuration builds the app into `dist/`. Push or deploy only with explicit authorization.
