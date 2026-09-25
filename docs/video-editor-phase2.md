# Video editor, Phase 2: the editor

Route: `/edit/<draftId>` (`app/edit/[draftId]/page.tsx` → `features/editor/pages/EditorPage.tsx`).
Reached from the Edit stage of the Script Kanban ("✂ Open in editor" on the card and in the
draft's Finished Video section). The existing "Upload Edited Video" action is untouched and
stays the way a cut reaches `editedVideoUrl` until Phase 4 gives the editor an Export.

## What is built (steps 1–5)

1. **Load.** Opening a draft calls `GET /api/edit-projects?draftId=`, which creates the project
   from `rawContentUrls` on first open. Each asset gets a hidden `<video>` (through `/api/vid`,
   like every other player in the app); on `loadedmetadata` its duration expands the 0-length
   placeholder clip and the timeline appears.
2. **Trim, split, reorder, delete.** Edge drags trim (`inMs`/`outMs`), `S` or ✂ splits the
   selected track at the playhead, dragging a main clip drops it at the index under the pointer,
   `⌫` deletes. Every gesture is one undo step (`⌘Z` / `⌘⇧Z`, 100 deep). The main track is always
   contiguous; `at` is derived, never edited.
3. **Frame-accurate preview.** Video is never copied to a canvas. Each asset is a real `<video>`
   in the preview's video layer, shown and positioned with CSS when its clip is on screen
   (hardware decode and composite; b-roll is a second stacked element), and a transparent canvas
   above it paints only captions and text, sized to what is on screen. While playing, the active
   main clip's `<video>` is the clock: one tick per decoded frame via `requestVideoFrameCallback`
   (its `mediaTime`), with `requestAnimationFrame` as the fallback, never wall time; a 250 ms
   watchdog keeps the clock alive while the element buffers. The overlay is repainted only when
   what it would paint changes. While paused, every seek positions the elements and repaints on
   `seeked`. Media plays straight from R2 through a presigned GET on the S3 endpoint
   (`/api/r2/sign-get`, one hour, re-signed once on error, then the `/api/vid` proxy as the last
   resort); the proxy is a function in the path and r2.dev is rate-limited, neither of which a
   40 Mbps 4K clip tolerates. `←`/`→` step one frame (`⇧` = 1 s), `space` plays.
4. **Caption + text tracks.** Captions are cues on the caption track drawn with the document's
   `captionStyle`; free text elements carry their own `CaptionStyle` and a `Transform`, and can
   be dragged on the preview. The inspector edits position, font, size, colours, outline, shadow,
   box, anchor, alignment, margins and timing. "Save as this client's default" writes
   `Client.subtitleStyle`.
5. **B-roll.** A second video track above the main one; clips come from the project's assets or
   a new upload (same `/api/r2/multipart` flow as raw content), are placed at the playhead, can
   be dragged in time and on the preview, and are always silent.

## Layout (2026-09-25, rebuilt to CapCut's structure)

A top bar (save state, project name, Share/Export), then three sibling panels in a row, each
with its own 46 px header, then the timeline spanning the full width below a draggable divider.
The LEFT panel (a third) has the tab bar (Media, Audio, Text, Stickers, Effects, Transitions,
Captions, Filters, Adjust, Templates) as its header row, a secondary nav column down its left
edge, a content area with its own toolbar row (Import, Record, search, view, sort, filter) and a
footer bar. The CENTRE panel (the largest) is headed "Preview — <draft>" with a menu icon and
carries the transport under the video. The RIGHT panel (narrow) is headed "Details" and shows
the selection's properties (clip, caption or text; otherwise the document's caption style).
Every CapCut control without a feature behind it is a real, disabled control with a
"not built yet" tooltip. Media is real:
the project's clips with load state, import to R2, add to main or as b-roll at the playhead,
retry or remove a failed clip. Text and Captions list their tracks. The other tabs open an
honest "not built yet" state with one line on what will live there; they are the frame, not
the feature. A clip whose media never loads is timed out (20 s), diagnosed through the proxy
and marked failed with the reason in the preview, the timeline and the Media panel.

## Holding the parity line

The canvas renderer (`features/editor/render/canvasText.ts`) draws only what `CaptionStyle`
declares, with ASS semantics: sizes in canvas px, line box = font ascent + descent, explicit
lines only, outline stroked at 2x width under the fill, shadow as one diagonal offset, box per
line, anchor/align/margins as ASS Alignment and MarginL/R/V. The inspector offers no control
that is not a style property. Nothing from the "not representable" list exists anywhere in the
editor: no line height, gradients, blur, rounded boxes or animation. Text elements do not expose
rotation (their transform's `rotation` stays 0) because rotation is not in the parity table.

## Saves and the 409

Autosave 1.5 s after the last change, `PUT /api/edit-projects/:id { document, version }`. On
409 the banner names who saved and when, marks your changes unsaved, and offers **Reload their
version** (discards yours) or **Overwrite with mine** (explicit, re-saves against their
version). Autosave is suspended until one is chosen. Leaving the page with unsaved changes asks
first.

## Theme

Tokens only: `bg-surface`/`bg-surface-2`/`bg-canvas-2`, `text-ink`/`text-muted`/`text-faint`,
`border-line*`, status and hue families for the four track colours (emerald main, sky b-roll,
warn captions, violet text), `o-btn-*` buttons. One token was minted per the dark-mode rules:
`--color-hue-violet-100` (light = Tailwind's exact `violet-100`, dark = the hue at 18 % alpha).
The preview canvas and its overlays are media chrome and stay black/white by design.

## Verified how

`npx tsc --noEmit`, `eslint` on the editor files (0 errors) and a full `next build` pass. The
timeline operations and the document normaliser were run under Node against a synthetic
document (split, trim, reorder, delete, boundaries, JSON round trip, garbage in). The caption
renderer was driven in headless Chromium with the shipped fonts and screenshotted. The app has
no local database, so the full page has not been clicked through here; the first real run is the
owner's, on production.

## Keyboard

`space` play/pause · `←`/`→` frame · `⇧←`/`⇧→` second · `S` split · `⌫` delete · `⌘Z` undo · `⌘⇧Z` redo
