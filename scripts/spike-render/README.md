# Render architecture spike (video editor, Phase 0)

Throwaway harness that measured where ORDO's in-app video editor should render. The numbers and
the decision are in `docs/video-editor-phase0.md`; this folder exists so they can be re-run.
Nothing here is imported by the app.

The job is always the same: a 60 s 1080x1920 30 fps H.264 clip (~8 Mbps, AAC) with 76 word-timed
ASS captions burned in, encoded with `libx264 -preset veryfast -crf 23` (and `ultrafast` as the floor).

## Files

- `make-input.sh` — generates `input.mp4` + `captions.ass` with a native ffmpeg. Put a `Roboto-Bold.ttf` in `<outdir>/fonts`.
- `server.mjs` — static server with switchable headers: `--coi` (COOP+COEP), `--cors`, `--corp`. `POST /result?name=` stores a JSON result.
- `www/render.html` — runs the job in ffmpeg.wasm. `?core=st|mt&preset=…&threads=N&name=…`. Expects `/lib` (the files from `public/ffmpeg`), `/core-st` (`@ffmpeg/core` 0.12.10, byte-identical to `public/ffmpeg`), `/core-mt` (`@ffmpeg/core-mt` 0.12.10) and `/media` (the job).
- `www/coi.html`, `www/parent.html`, `www/plain.html` — cross-origin-isolation probes: what COEP does to `<img>`, `<video>`, `fetch`, iframes and `SharedArrayBuffer`, top-level and when framed by a plain parent (the Cenks Dashboard).
- `run-browser.mjs` — drives headless Chromium (playwright-core + the cached `chromium-1243` build) and records peak renderer RSS via `ps`.
- `run-sim.sh` — opens a URL in the booted iPhone simulator and records peak `WebContent` RSS.
- `vercel-fn/` — a standalone Vercel project (plain `api/render.js`, `ffmpeg-static`) that downloads the input over HTTPS, renders, verifies the output and reports wall time, CPU time and peak RSS from `/proc`.
- `run-sandbox.mjs` — the same job in a Vercel Sandbox microVM at N vCPUs.
- `results/` — the raw JSON every run produced.

## Re-running

```
npm init -y && npm i playwright-core@1.58 @vercel/sandbox        # in a scratch dir next to these files
./make-input.sh media
node server.mjs --port 4100 --root www &                          # plain
node server.mjs --port 4101 --root www --coi &                    # isolated
node server.mjs --port 4102 --root www --cors &                   # "R2 with CORS"
node server.mjs --port 4103 --root www --corp &                   # "CDN that sends CORP"
node run-browser.mjs "http://localhost:4100/render.html?core=st&preset=veryfast&name=chrome-st" chrome-st
node run-browser.mjs "http://localhost:4101/render.html?core=mt&preset=veryfast&name=chrome-mt" chrome-mt
node run-browser.mjs "http://127.0.0.1:4100/parent.html?child=http://localhost:4101/coi.html&name=embedded" embedded
cd vercel-fn && vercel deploy --prod --yes && curl "https://<alias>/api/render?src=https://<alias>/input.mp4&preset=veryfast"
node run-sandbox.mjs 2 veryfast
```
