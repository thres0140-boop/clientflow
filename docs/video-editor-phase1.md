# Video editor, Phase 1: project model, caption-style definition, render seam

Decision carried over from Phase 0 (`docs/video-editor-phase0.md`), with the owner's override:
exports render in a **Vercel Sandbox** (4 vCPU / 8 GB, 14 s for a minute of footage), not in a
Vercel Function, because the only way to make the function fast re-prices every route in the app.

## Ceilings under Sandbox

| Ceiling | Value | Where it comes from |
|---|---|---|
| Footage per export | 15 min of timeline, refused at POST with a 422 | `RENDER_LIMITS.MAX_TIMELINE_MS`; at the measured 0.23x realtime on 4 vCPU that is ~3.5 min of render, far inside the sandbox timeout |
| Runner timeout | 20 min per job | `RENDER_LIMITS.TIMEOUT_MS`; Sandbox allows up to 24 h on Pro, 45 min on Hobby |
| Concurrency | one job per project; unlimited across projects | Pro: 10,000 concurrent sandboxes; the allocation quota starts at 150 vCPU/min, i.e. ~37 four-vCPU sandboxes per minute before creation is throttled, which is orders of magnitude above the two or three exports a day this app makes |
| Two exports at once | two sandboxes, nothing shared | each has its own CPU, memory, disk (64 GB) and one-minute memory minimum; they cannot slow each other down or the app |
| Same project twice | the running job is returned, no second sandbox | `RENDER_LIMITS.ONE_ACTIVE_JOB_PER_PROJECT` |
| Input size | whatever R2 holds | the runner downloads from R2 (free inbound); the 4.5 MB function body limit never applies |
| Cost per export | ~$0.01 for a 60 s reel at 4 vCPU | dominated by egress of the finished MP4 and the memory minimum, see Phase 0 |

## Schema

Applied with the admin migrate route's new isolated branch `GET /api/admin/migrate?editor=1&token=…`
(single statements, `IF NOT EXISTS`, re-runnable, followed by an `information_schema` read-back so
the response proves what exists). The same tables are declared in `prisma/schema.prisma`; those
two hunks were swept into commit 613d129 by the Inbox-mirror session working in the same tree.

```
Client.subtitleStyle   TEXT NULL       -- JSON CaptionStyle: the client's default on-screen caption look

EditProject            one per ScriptDraft
  id, draftId UNIQUE → ScriptDraft (cascade), clientId
  document TEXT '{}'   -- the whole EditDocument as JSON
  version INT 1        -- bumped on every save; a save must present the version it loaded
  updatedBy, createdAt, updatedAt

RenderJob              what the editor polls
  id, projectId → EditProject (cascade), documentVersion
  status TEXT 'queued' -- queued | running | done | failed | cancelled
  executor TEXT        -- "sandbox"; executorRef TEXT = the executor's opaque handle
  progress INT 0, outputKey, outputUrl, error, requestedBy
  createdAt, startedAt, finishedAt
  index (projectId, createdAt)
```

**JSON in a String column, read with bare `JSON.parse`: matched.** The one departure is on the
read side: `parseDocument()` and `normalizeDocument()` never throw. A corrupt or old document
coerces to a valid one (unknown fonts fall back, numbers clamp, the main track is re-derived) so
a bad row cannot brick the editor. Everything else in the app does `try { JSON.parse } catch {}`
at each call site; here there is one call site, so the guard lives there.

**Resumable by another person on another device:** the document is the entire editor state, and
every save is `UPDATE … WHERE id = ? AND version = ?`. A stale save gets a 409 with the current
project (including `updatedBy`) so the editor can show who saved in between. Last-write-wins was
rejected: two people trimming the same reel would silently lose work.

### The document (`features/editor/model/document.ts`)

```
EditDocument {
  v: 1
  canvas { width 1080, height 1920, fps 30 }
  assets[]      { id, kind video|image, url (the R2 url exactly as stored on the draft), name, durationMs?, width?, height? }
  tracks[]      draw order bottom → top:
    VideoTrack  { role "main" | "overlay", clips[] }
      VideoClip { assetId, at, inMs, outMs, transform, muted, volume }
    CaptionTrack{ cues[], styleOverride? }
      CaptionCue{ startMs, endMs, lines[] (explicit, pre-wrapped), words[]? }
    TextTrack   { elements[] }
      TextElement { text, startMs, endMs, style: CaptionStyle, transform }
  captionStyle  CaptionStyle (the one definition)
  transcript?   { source "whisper-1", language, words[] } — Phase 3, kept so cues can be re-chunked without re-running Whisper
}
Transform { x, y (centre, fraction of canvas), scale (1 = fit height), rotation °, opacity }
```

Invariants enforced on every read: exactly one main track; its clips are contiguous and `at` is
derived from the clips before it (the main track *is* the timeline; overlays and captions cannot
extend it); every clip's asset exists. All times are integer ms.

A project is created on first open (`GET /api/edit-projects?draftId=`) from the draft's
`rawContentUrls` in upload order, with the client's `subtitleStyle` or the built-in default.
Durations are unknown until a browser reads the metadata, so new clips are 0-length placeholders
that Phase 2 expands.

## Caption style: one definition, two renderers (`features/editor/model/captionStyle.ts`)

Everything is in canvas px (ASS gets `PlayResX/Y` = canvas, so px map 1:1) and only in terms both
the canvas preview and libass implement the same way:

```
CaptionStyle {
  font      { family (registry), weight, sizePx, letterSpacingPx, italic, uppercase }
  fill      { color }
  outline   { color, widthPx }
  shadow    { color, offsetPx, opacity }        one diagonal offset, no blur
  box       { enabled, color, opacity, paddingPx }
  layout    { anchor top|middle|bottom, align, marginVPx, marginHPx, maxLines 1..3, wordsPerCue 1..6 }
  highlight { mode none|color, color }          the word being spoken
}
```

The font registry is fixed (`Roboto`, `Inter`, `Montserrat`, `Bebas Neue`, one file each). The
same TTF is served to the canvas via `@font-face` and shipped to the runner via `fontsdir`; that,
not any renderer setting, is what makes glyph widths identical on both sides. The files land in
`public/fonts/captions/` in Phase 2 when the canvas first needs them.

**Guaranteed parity** (same numbers, same result, positions within 1 px): font family, weight and
size; letter spacing; uppercase (applied to the text before either renderer sees it); fill
colour; outline colour and width; anchor, alignment and margins; line breaks (cues store explicit
lines, nothing auto-wraps, ASS gets `WrapStyle 2` and `\N`); cue timing and words per cue; the
active-word colour change; italic where the font has a true italic.

**Approximate**: shadow (ASS has one diagonal offset and no blur, so the canvas is restricted to
the same); the background box (ASS BorderStyle 4 pads by the outline width per line, the canvas
pads by `paddingPx` per line; both are plain rectangles); outline joins at widths above 6 px;
emoji (both fall back to a system emoji font that differs per machine).

**Not representable, on purpose**: line height, gradients or image fills, blur or glow, rounded
box corners, per-word animation (pop, bounce, typewriter), mixed fonts or sizes inside one cue.
A future property has to be provable on both renderers before it enters the type.

### Where the per-client default lives, and why not `captionStyle` / `captionGuidelines`

Phase 3's brief says to reuse `Client.captionGuidelines` / `captionStyle`. Both are prose briefs
for *writing Instagram post captions*: `generate-caption`, `script-drafts/generate` and `remix`
splice them into the writer prompt as "write captions in this style". They contain sentences,
not fonts or colours, and they are edited as text in Settings. Putting a JSON style blob in either
would break those prompts. So the visual default gets its own nullable column,
`Client.subtitleStyle`, read by `captionStyleForClient()` with a fallback to the built-in
default. It is a column, not a settings surface: the editor's "save as this client's default"
action (Phase 2) is its only UI. `captionGuidelines` stays what it is; Phase 3 may still read it
for *text* decisions such as uppercase or language, and that will be said explicitly then.

## The render seam (`features/editor/server/executor.ts`)

```
interface RenderExecutor {
  name: "sandbox"
  start(plan: RenderPlan): Promise<{ ref: string }>     // seconds; the HTTP request ends after this
  poll(ref): Promise<{ state: "running", progress } | { state: "done" } | { state: "failed", error }>
  cancel(ref): Promise<void>
}
RenderPlan { jobId, document, inputs[] {assetId,url,fileName}, fonts[] {family,fileName,url},
             output {key, uploadUrl (presigned R2 PUT), publicUrl}, limits {maxDurationMs, timeoutMs} }
```

The plan is executor-independent: inputs and fonts are URLs the runner downloads, the output is
a presigned PUT the runner performs itself, so no media ever crosses a function body and the app
only has to trust `publicUrl`. `getRenderExecutor()` is the single place an implementation is
chosen (`RENDER_EXECUTOR`, default `sandbox`). `SandboxRenderExecutor` documents the mapping
(`ref` = `{ sandboxId, cmdId }`, detached `runCommand`, poll via `Sandbox.get` + command exit
code, stop on terminal state) and throws until Phase 4, so Phase 1 ships no code path that can
spend money. Neither the routes, the job service nor the document know where rendering happens.

Routes (all behind the session cookie; member sessions are checked against the project's
`clientId` here because `proxy.ts` only scopes `?clientId`):

```
GET    /api/edit-projects?draftId=        get-or-create                     → { project }
GET    /api/edit-projects/:id                                               → { project }
PUT    /api/edit-projects/:id             { document, version }             → { project } | 409 { project }
POST   /api/edit-projects/:id/render      start (422 over the ceiling)      → 202 { job } | 200 { job, reused: true }
GET    /api/edit-projects/:id/render      the active job                    → { job | null }
GET    /api/render-jobs/:id               poll (asks the executor while running) → { job }
DELETE /api/render-jobs/:id               cancel                            → { job }
```

The editor polls `GET /api/render-jobs/:id` every 2 s (`RENDER_JOB_POLL_MS`). Writing the result
to `ScriptDraft.editedVideoUrl` and advancing the stage is Phase 4 and will match the Kanban
"Upload Edited Video" action exactly; the job row deliberately does not do it.
