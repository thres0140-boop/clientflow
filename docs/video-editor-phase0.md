# Video editor, Phase 0: where does rendering happen?

Measured 2026-09-24. Harness and raw JSON in `scripts/spike-render/`. Every number below is a
measurement from that harness, not an estimate; the few things that could not be measured are
marked as such.

## The job

One realistic export: a 60 s 1080x1920 30 fps H.264 clip (7.98 Mbps, AAC stereo, 58 MB, the shape
of an iPhone reel upload) with 76 word-timed ASS captions burned in (bottom third, 72 px bold,
5 px outline), encoded with `libx264 -preset veryfast -crf 23 -c:a copy`. `ultrafast` was run as
the floor: it is ~2x faster everywhere but produces a 107 MB file instead of 40 MB, which then has
to be uploaded and posted, so `veryfast` is the number that matters. Every output was verified to
decode to 1800 frames.

Machines: this Mac (Apple M4, 10 cores, 16 GB), headless Chromium 1243 (Chrome for Testing),
the iPhone 17 Pro simulator (iOS 26.2, WebKit), Vercel Functions in `iad1` (Fluid, Node 24),
Vercel Sandbox in `iad1`.

## Results

| Option | Config | Wall (veryfast) | Wall (ultrafast) | Peak memory | Completes |
|---|---|---|---|---|---|
| A. ffmpeg.wasm single-thread (what TranscribePage loads) | Chrome, M4 | **82.3 s** | 29.1 s | 652 MB renderer RSS (1.23 GB all browser children) | yes |
| A. same | iPhone simulator Safari | **85.7 s** | not run | 691 MB WebContent RSS | yes (simulator; see iOS note) |
| B. ffmpeg.wasm multi-thread, auto threads | Chrome, isolated top-level | **failed 5 of 5** | 6.6 s | 922 MB renderer RSS | no (see B) |
| B. same, `-threads 4` | Chrome, isolated top-level | 31.3 s | not run | 940 MB | yes |
| B. same, auto threads | iPhone simulator Safari | **failed 2 of 2** | not run | 993 MB WebContent RSS at load | no |
| B. any | embedded in a plain parent (Cenks Dashboard) | cannot start | cannot start | – | no: `crossOriginIsolated=false`, no `SharedArrayBuffer` (Chrome and Safari) |
| C. Vercel Function, Standard CPU (default; 2 GB) | ffmpeg-static, Xeon 2.5 GHz | **60.7 s** (68 CPU-s) | 28.8 s (32 CPU-s) | 357 MB ffmpeg RSS + 282 MB Node | yes |
| C. Vercel Function, Performance CPU (project setting; 4 GB) | same | **36.1 s** (50 CPU-s) | 17.1 s (24 CPU-s) | 388 MB + Node | yes |
| D. Vercel Sandbox, 2 vCPU / 4 GB | static ffmpeg 7.0.2 | **24.7 s** (47.5 CPU-s) | not run | 365 MB | yes |
| D. Vercel Sandbox, 4 vCPU / 8 GB | same | 14.0 s (46 CPU-s) | not run | 445 MB | yes |
| D. Vercel Sandbox, 8 vCPU / 16 GB | same | 9.8 s (55.5 CPU-s) | not run | 595 MB | yes |
| reference: native ffmpeg on this Mac | 10 threads / 2 threads / 1 thread | 4.1 s / 7.2 s / 16.1 s | 2.2 s | 590 MB / 285 MB / 229 MB | yes |

Input transfer inside the server options: the function pulled the 58 MB input over HTTPS in
0.4–1.9 s; uploading it into the Sandbox from here took 5.7–9.1 s (a real job would pull from R2
in the sandbox instead).

### Cost per rendered minute (server options, `iad1` list prices, 2026-09)

Vercel Functions: Active CPU $0.128/h, provisioned memory $0.0106/GB-h, $0.60 per million
invocations. Sandbox: Active CPU $0.128/h, memory $0.0212/GB-h billed in 1-minute minimums, and
$0.15/GB for data the sandbox *sends* (the finished 40 MB file going to R2 is billable egress).

| Option | CPU | Memory | Egress | Per rendered minute |
|---|---|---|---|---|
| C. Function, Standard, veryfast | 68 s → $0.0024 | 2 GB x 73 s → $0.0004 | – | **$0.003** |
| C. Function, Performance, veryfast | 50 s → $0.0018 | 4 GB x 45 s → $0.0005 | – | **$0.002** |
| C. Function, Standard, ultrafast | 32 s → $0.0011 | 2 GB x 35 s → $0.0002 | – | $0.001 |
| D. Sandbox 2 vCPU, veryfast | 47.5 s → $0.0017 | 4 GB x 1 min → $0.0014 | 40 MB → $0.006 | **$0.009** |
| D. Sandbox 4 vCPU | 46 s → $0.0017 | 8 GB x 1 min → $0.0028 | $0.006 | $0.010 |
| D. Sandbox 8 vCPU | 55.5 s → $0.0020 | 16 GB x 1 min → $0.0057 | $0.006 | $0.014 |

Both are noise at ORDO's volume (a few exports a day). The Sandbox's cost is dominated by egress
and the one-minute memory minimum, not by compute.

## What each option actually ran into

### A. Single-threaded ffmpeg.wasm

Works as-is with the files already in `public/ffmpeg` (byte-identical to `@ffmpeg/core` 0.12.10,
and that build does include `libass`, so `subtitles=` and `drawtext` are available). No headers,
no infra, works embedded. It is 1.4x slower than real time on an M4 at `veryfast`, so a 90 s reel
is a 2-minute wait with the tab open, and the whole input plus output sits in wasm memory
(~650 MB for this job; a 3-minute clip would be ~1.5 GB). Ultrafast halves the time but nearly
triples the file.

### B. Multi-threaded ffmpeg.wasm

Three separate problems, each measured:

1. **It cannot run inside the Cenks Dashboard.** Cross-origin isolation is a property of the
   *top-level* page. A COOP+COEP ORDO framed by a plain parent reports `crossOriginIsolated=false`
   and has no `SharedArrayBuffer` in both Chrome and Safari (`results/coi-embedded-in-plain-parent.json`,
   `results/ios-sim-safari-coi-embedded.json`). The dashboard would have to adopt COOP/COEP itself.
2. **COEP `require-corp` breaks the media ORDO loads directly.** Under isolation, a cross-origin
   `<img>`/`<video>` without a `Cross-Origin-Resource-Policy` header errors (measured: `error`),
   while the same file through a same-origin proxy or with `crossorigin` + CORS loads. The app has
   direct r2.dev / Instagram-CDN `<video>` and `<img>` tags in `features/chat/pages/ChatPage.tsx`,
   `features/content/pages/Pipeline.tsx`, `features/instagram/pages/InstagramPage.tsx` and
   `features/analytics/pages/Analytics.tsx` that would all have to move to `/api/vid`, `/api/img`
   or gain `crossorigin` (R2 CORS is only configured for uploads today). Safari additionally
   blocked a cross-origin iframe without COEP (`timeout`). Excalidraw itself is fine: its only
   cross-origin fallback is `esm.sh`, which answers with `access-control-allow-origin: *`, and font
   loads are CORS requests. The `credentialless` COEP mode that would avoid the media breakage is
   not implemented in Safari, so it does not help iOS.
3. **The mt core is unreliable even when isolation works.** With the same page, same files and
   auto thread count, `@ffmpeg/core-mt` 0.12.10 threw a message-less exception from its first
   `exec` in 5 of 5 Chrome runs and 2 of 2 Safari runs (`TypeError: … e.message.startsWith`, i.e.
   Emscripten's pthread unwind reaching the core's catch block). Two configurations that differ
   only in query parameters (`ultrafast`, and `-threads 4`) ran fine, which points at a startup
   race, not something ORDO can configure away. It also reserves ~1 GB of shared memory at load
   (993 MB WebContent RSS in Safari before it failed).

When it does run it is the fastest in-browser option (6.6 s ultrafast on 10 cores), which is why
it had to be measured. It is foreclosed by (1) alone.

### C. Vercel Function

Current documented limits (docs last updated 2026-08-24, checked today): default duration 300 s,
maximum 800 s on Pro (1800 s beta), request and response bodies 4.5 MB, bundle 250 MB (5 GB in
the large-functions beta), memory 2 GB / 1 vCPU default and 4 GB / 2 vCPU maximum on Pro.
`clientflow` is on Fluid in `iad1` with the default (Standard) CPU tier.

The 4.5 MB body limit never comes into play: the function fetched the input from a URL and would
PUT the output to R2 with a presigned URL. `ffmpeg-static` (John Van Sickle build, has libass)
fits the bundle with room to spare; the font is shipped alongside via `includeFiles` (in Next.js:
`outputFileTracingIncludes`). Peak RSS ~640 MB total for the job, well inside 2 GB.

Two things learned: the per-function `memory` key in `vercel.json` did **not** change the CPU
allotment on Fluid (2048 and 4096 gave identical 60.7 s / 61.7 s, ~1.1 CPU-s per wall second);
the project-level *Function CPU: Performance* setting did (36 s, 3 visible CPUs, 4.4 GB). That
setting is project-wide, so it raises memory billing for every function in `clientflow`. And a
render is a 40–75 s request: the client must not depend on the response, otherwise an iOS tab
going to the background cancels the export. Kick off, return a job id, keep working with
`waitUntil` from `@vercel/functions`, poll a status column.

### D. External render service (measured as Vercel Sandbox)

A Firecracker microVM with real cores: 24.7 s on 2 vCPU, 9.8 s on 8. The spike installed a
static ffmpeg per run (2.8 s); a snapshot would remove that. It needs a second runtime, the
`@vercel/sandbox` SDK with an OIDC token, an image or snapshot to maintain, egress billing for
the output, and the same job-and-poll plumbing as C. Non-Vercel boxes (a VPS, Cloud Run, Fly)
were not measured; the native reference row is what a dedicated arm64 box would do.

### iOS Safari, honestly

No physical iPhone was reachable (Cenk's iPhone shows as `unavailable` to `devicectl`), so the
iOS rows are the iPhone 17 Pro *simulator*: real WebKit, real headers and isolation behaviour,
but the Mac's CPU and no iOS memory-pressure kills. What is established: the single-threaded core
completes the job in WebKit at ~690 MB; the multi-threaded core fails in WebKit for the reasons
above; isolation inside an iframe is false in WebKit too. What is *not* established is whether a
real iPhone keeps a 700 MB tab alive for 90 s of wasm; that is the number A would have to prove
before being trusted on a phone. C and D do not touch the phone at all.

## Recommendation: C, server-side on a Vercel Function

Render exports in a Node route on Fluid with `ffmpeg-static`, pulling the clips from R2 by URL
and pushing the MP4 back through the existing presign flow, tracked by a job row that the editor
polls. 61 s for a minute of footage on the default tier is acceptable for 30–90 s reels; if it
feels slow, the Performance tier halves it at the cost of project-wide memory pricing. The
Sandbox is the escalation path if jobs ever outgrow the function: same ffmpeg command, same
inputs, only the runner changes.

Why not A: it works, but it makes the operator's device the render farm (1.4x real time on an M4,
unproven on a phone, tab must stay open) and pushes the memory ceiling onto the browser.
Why not B: foreclosed by embedding alone, and unreliable on top.
Why not D first: it is faster, but for 60–90 s clips the function is already inside a minute, and
D adds a runtime, an SDK, egress and image upkeep for a speed nobody is waiting on.

### What C forecloses

- **In-browser multithreading, forever.** COOP/COEP will not be enabled, so no `SharedArrayBuffer`
  anywhere in the app. Anything wasm stays single-threaded (TranscribePage is unaffected).
- **Long renders.** ~1 s of function time per second of footage on Standard: 300 s default covers
  ~4.5 min of footage, the 800 s Pro maximum ~12 min. Longer jobs must be split or moved to D.
- **Free and offline exports.** Every export is a function invocation (~$0.003) and needs the
  server; nothing renders on a plane.
- **Preview and render are two renderers.** The timeline preview stays an HTML5 `<video>` with a
  canvas overlay; the export is libass/`drawtext`. Caption style has to be one JSON definition
  mapped to both, and the fonts have to be shipped to both, or the export will not match the
  preview. This is true of A and B as well, since nobody previews through ffmpeg, but with C the
  two run on different machines, so parity has to be tested rather than assumed.
- **Binary in the bundle.** `ffmpeg-static` (~80 MB) and the caption fonts have to be traced into
  the Next build for that one route; the boundary script does not care, `tsc` does not care, but
  the route's config must pin `runtime = "nodejs"` and a `maxDuration` of at least 300.

## Cleanup

The spike's Vercel project (`ordo-render-spike`) was deleted after measuring. Nothing in the app
changed. The two CDN/COI probe servers were local only.
