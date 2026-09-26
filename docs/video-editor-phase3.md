# Video editor, Phase 3: auto-captions

"Generate captions" in the editor's Captions tab. Whisper supplies the timing, the draft's script
supplies the wording, the caption style decides the layout, and every cue stays editable.

## Where extraction happens, and why: the server

The sources are the draft's raw uploads: 4K phone clips of 300–900 MB. Whisper accepts 25 MB of
audio. Two places could extract that audio:

- **Browser, ffmpeg.wasm** (what TranscribePage does for files the person picks by hand). The
  whole clip must sit in wasm memory, and the single-threaded core tops out around 2 GB; a 90 s
  4K clip is 450 MB, a 3-minute one 900 MB, and iOS Safari would kill the tab long before. The
  editor would also have to download a file it already streams for playback.
- **Server, ffmpeg-static in the route** (`POST /api/edit-projects/:id/transcribe`). ffmpeg reads
  the clip straight from R2 through a presigned GET on the S3 endpoint, decodes only the audio
  track and writes a mono 16 kHz 32 kbps MP3: about 4 KB per second of speech, 360 KB for a
  90 s reel, 3.6 MB for the 15-minute ceiling. Nothing but that MP3 is held in memory. If the
  static build cannot read https, the clip is staged in `/tmp` (up to 450 MB of the 500 MB a
  function has) and read from there; larger than that is refused with a clear message.

So: the server. Audio-only decode is light enough for the default function tier (this is not the
video render, which stays in the Sandbox). `next.config.ts` traces the ffmpeg binary into that
one route and keeps `ffmpeg-static` external.

## Whisper, verified

`response_format=verbose_json` with `timestamp_granularities[]=word` (and `segment`, for the
hallucination filter), `language=<Client.language>` (ISO-639-1, "nl"), and `prompt` = the first
~150 words of the draft's hook + script, which is Whisper's own vocabulary-hint mechanism and
carries the client's jargon and names. Checked against the OpenAI SDK's parameter definitions,
not remembered. The existing `stripHallucination` from `features/instagram/server/reelCapture.ts`
is exported and reused (no fourth copy): a segment it flags takes its words with it.

## Cache

Per clip, in R2: `transcripts/<sha1(url | language | model | v1)>.json`, written after every
paid run and read before any. A second Generate, a re-layout, a reload, a conflict resolution or
another project cutting the same footage costs nothing. The document keeps the words too
(`transcript.assets[]`, in asset time), so re-chunking after a trim, a reorder, a style change
or a wording toggle is local and instant. `force: true` bypasses the cache.

## Layout

`timelineWords()` places each asset's words through every main-track clip that shows that part
of the file (a clip trimmed to 2–6 s contributes only the words inside 2–6 s; a reorder re-times
them). `layoutCaptions()` then groups `wordsPerCue` words per cue, ends a cue early at a pause
over 900 ms, spreads the words over up to `maxLines` explicit lines balanced by length, gives a
cue at least 400 ms and lets it hold up to 350 ms into the following silence without ever
overlapping the next cue. Uppercasing is not applied to the text: it is a style property applied
at draw time on both renderers.

## Script alignment: shipped, with a floor

The draft's hook + script is the ground truth for WHAT was said; Whisper is trusted for WHEN.
`alignToScript()` runs a longest-common-subsequence alignment over normalised tokens (lowercase,
no accents, no punctuation) and then:

- a matched word takes the script's spelling, case and punctuation with Whisper's timing;
- an equal-length gap of one or two words on both sides is a mishearing ("coatches" → "coaches"),
  and takes the script's words with Whisper's timing;
- a longer run of unmatched Whisper words is improvisation and is kept exactly as heard, in
  place; the script words that faced it are skipped, not invented;
- a run of unmatched script words with no speech is a skipped line and is dropped.

Drift therefore costs nothing: the alignment re-synchronises at the next matching word. The
failure mode is a speaker who did not follow the script at all. When fewer than 60 % of
Whisper's words match or substitute, the result is discarded and the plain transcript is used,
and the Captions tab says so with the percentage. The toggle "Use the script's wording" is on by
default when the draft has a script and off (disabled) when it has none. Tested on a Dutch
sentence with a misheard word, an improvised aside, a skipped tail and an unrelated speech.

Verdict: worth doing, not fragile, because the worst case is the plain transcript with a
message. What it cannot do is invent timing for script words that were never spoken.

## Editing and export

Every cue is a `CaptionCue` on the caption track: lines, timing and word timing are edited in
Details or by dragging on the timeline, and a cue can now carry its own `styleOverride` (the
same property set as `CaptionStyle`, so it crosses to libass as a per-cue ASS Style and never
introduces a property the parity table does not cover).

## Ceiling

15 minutes of main-track audio per project (`RENDER_LIMITS.MAX_TIMELINE_MS`, the same ceiling
as the export). Above it the route answers 422 and the tab shows the message; the MP3 for 15
minutes is 3.6 MB, well inside Whisper's 25 MB. The route runs with `maxDuration = 300`.

## Caption presets (added 2026-09-25)

`features/editor/model/captionPresets.ts` ships seven built-in presets — bold outline, spoken word
in yellow, spoken word in green, boxed lines, boxed yellow on black, minimal lowercase (Inter
400, a new weight in the registry with its own TTF), and a big centred single-line hook — each a
complete `CaptionStyle` and nothing more, so each crosses to libass by construction. The Captions
tab's Presets sub-nav renders them as real previews through the same `layoutText`/`drawText` the
preview uses, over the project's first clip's poster frame. Applying one replaces the document's
caption style; per-cue overrides live on the cues and survive.

**`Client.subtitleStyle` now holds a list.** It accepts either the original bare `CaptionStyle`
(the client default, still read) or `{ default: CaptionStyle | null, presets: NamedPreset[] }`.
One column, both shapes parsed, no migration; the editor's "Save as this client's default" writes
`default`, "Save current as preset" appends to `presets`, and the project GET returns both.

## Transitions (added 2026-09-25)

Between adjacent main-track clips: crossfade (`fade`), fade through black (`fadeblack`), slide
in four directions (`slideleft/right/up/down`) and zoom (`zoomin`). Each name IS the ffmpeg
`xfade` transition name, verified against `ffmpeg -h filter=xfade` and present in the
`ffmpeg-static` build, so the render plan is a lookup (`features/editor/pages/transitions.ts`).
`dissolve` and `fadewhite` exist in xfade too and were left out only for a smaller set.

Model: `VideoTrack.transitions[] = { afterClipId, type, durationMs }`; the clips overlap by the
duration, so the next clip's `at` is that much earlier and the timeline that much shorter (the
normaliser derives it). Default 500 ms, capped at half the shorter neighbour, one per cut,
dropped if the cut disappears; a split moves the transition after the second half. The timeline
shows a cut marker at every boundary and a band over the overlap; clicking selects the cut, and
Details edits type and duration. The preview shows both clips during the overlap with the
effect's opacity, offset and scale, an approximation of xfade, which is what exports.

## Speed (added 2026-09-25)

Per clip, `VideoClip.speed` from 0.5× to 2× with stops at 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 and
a free input. That range is what ONE ffmpeg `atempo` instance covers, and the export is
`setpts=PTS/speed` for video and `atempo=speed` for audio. atempo time-stretches, so **pitch is
preserved**; the preview sets `playbackRate`, which preserves pitch by default in every
browser, so preview and export agree. Pitch-shifting (asetrate) was not chosen: a talking head
at 1.25× must still sound like the person.

A clip's length on the timeline is its source span divided by the speed; `at` is derived from
it, so everything after the clip stays in step by construction. `setClipSpeed()` also retimes
what sits ON the clip: captions, text and b-roll that start inside the clip's old span are
rescaled within it (word timings included), and anything that starts after it shifts by the
change in length. Trims, splits, trim-to-playhead, transcript placement, transitions caps, hit
tests and the playhead clock all go through `clipLengthMs` / `sourceAt` / `timelineAt`.

## Animation in / out (added 2026-09-25)

`CaptionStyle.animation = { in, out }`, each `{ type, durationMs }` with `fade`, `slideleft`,
`slideright`, `slideup`, `slidedown`, `pop` or `none`. It is a property of the style, so it is
the default for every cue on the caption track and per-cue via a style override, and text
elements carry it in their own style. Checked against libass first: fade is `\fad`, slide is
`\move` from 160 px away (linear), pop is `\t` on `\fscx\fscy` from 60 % (linear). One ASS line
allows one `\move`, so a cue with both a slide-in and a slide-out exports as two events. Timing
is linear on both sides on purpose; durations are capped at half the on-screen time in both
renderers (`animationState()` is the shared formula). Nothing else was added: bounce, typewriter
and per-word pops have no libass equivalent and stay out.

## Clip blocks: filmstrip and waveform (added 2026-09-25, filmstrip moved server-side 2026-09-26)

Main-track clips show CapCut's three bands: a 17 px name strip, a filmstrip, and a 14 px
waveform. Both are cosmetic; the document and the export are untouched. Both are made on the
server once per asset and cached in R2, so the browser never decodes video for the timeline and
nothing competes with playback.

- **Filmstrip** (`GET /api/edit-projects/:id/filmstrip?assetId=`): ffmpeg reads the clip from R2
  over a presigned URL, decodes **keyframes only** (`-skip_frame nokey`) and tiles one 31×43 cell
  per `interval` seconds into a JPEG sprite, 24 cells per row, at most 480 cells (interval =
  max(1 s, duration / 480)). Each cell is the last keyframe at or before its slot. Full decoding
  was rejected by measurement: an 8-minute 4K 10-bit HEVC clip took 466 s to decode fully and
  42 s keyframes-only. Phone footage keeps a keyframe every ~1 s, so the strip is at least as
  fine as the 31 px cell at every zoom we ship; at high zoom neighbouring cells repeat the same
  keyframe, as CapCut's do. The sprite and its meta JSON live under `filmstrips/<sha1(url)>.v1`;
  the route answers with the meta and a one-hour presigned URL for the sprite. Cost: one
  keyframe pass per asset (seconds for a reel), then one small image per open.
  The earlier client-side sampler (a hidden `<video>` seeked per cell) is gone: it needed a
  CORS-enabled read of the clip and its decoder work made the timeline lag during playback.
  While the sprite loads, or when it cannot be made, the cell band is one flat muted band with no
  cell boundaries, so a pending strip never reads as broken frames.
- **Waveform** (`GET /api/edit-projects/:id/waveform?assetId=`): ffmpeg emits 4 kHz mono PCM;
  each 20 ms window becomes one peak byte (50 per second, 4.5 KB for a 90 s reel), cached in R2
  as `waveforms/<sha1(url)>.v1.json`. Browser-side decoding was rejected: it needs the whole 4K
  file in memory. Both routes log `[filmstrip]` / `[waveform]` lines with the outcome and timing,
  so a flat band can be traced in the Vercel runtime logs.
