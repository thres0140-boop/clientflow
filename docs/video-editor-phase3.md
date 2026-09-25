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
