# E20 — CapCut vs ORDO editor: visual inventory

Measured 2026-09-26 from native CapCut captures at its real full-screen size
(window 1710 × 1107 css px on this display; captures are 2×, css = capture / 2).
ORDO's side is read from the source in `features/editor/pages/` because the
production page needs a login this session did not have; "ours" therefore means
the authored value, not a rendered measurement.

States captured: the eleven left-panel top tabs (Media … Sjablonen, AI-avatar
via the overflow arrow) and the right panel with a video clip selected (Video,
Audio, Snelheid, Animatie, Aanpassing, AI-stilering, plus the Video sub-tabs
Eenvoudig, Achtergrond verwijderen, Masker, Retoucheren). Everything else —
second-level sub-tabs, every other timeline selection state, preview
selection, dialogs — is **not captured** and is listed as such at the end.

Each row gives CapCut's absolute value and its share of the container, ours,
and which of the two was copied. Tags: COPYABLE (a value), REDRAW (a glyph or
control to redraw), STRUCTURAL (layout or grouping change), BLOCKED (a feature
we do not have or cannot export).

## Shell

| # | Item | CapCut | Proportion | Ours (source) | Tag | Copied |
|---|---|---|---|---|---|---|
| 1 | Outer margin / panel gutters / panel↔timeline gap | 9 / 7 / 6 px | — | 9 / 7 / 6 | — | same |
| 2 | Column widths left / preview / right | 573 / 576 / 529 | 33.5 / 33.7 / 30.9 % of 1710 | 33 % / flex / 30 % | — | proportion, already |
| 3 | Top bar height, title, Export button | 36 px, 12–13 px title, 90×22 teal | 3.3 % of height | 36, 12 px, 22 px | — | same |
| 4 | Timeline default height | 329 px | 29.7 % of 1107 | 292 | COPYABLE | absolute 329 (a proportional default would render differently on server and client) |

## Left panel

| # | Item | CapCut | Proportion | Ours (source) | Tag | Copied |
|---|---|---|---|---|---|---|
| 5 | Tab bar height | 42 px | 6.1 % of panel height | 42 | — | same |
| 6 | Tab pitch | content-driven: label width + ~21 px (10 px padding a side); pitches 49–65 | label + 3.7 % of panel | fixed `min-w-[100px]` | COPYABLE | absolute padding 10 px, no min width — the pitch is not a fraction of anything, it follows the label |
| 7 | Tab label font | 11 px medium (cap height 8) | — | 10 px | COPYABLE | absolute |
| 8 | Tab icon glyph | 19–20 px outline | — | 13 px | COPYABLE | absolute 19 |
| 9 | Active tab box | 27×22 teal, solid white glyph | — | 27×22 | — | same |
| 10 | Sub-nav column width | 120 px | 20.9 % of panel | 120 | — | same (our panel is the same share of the window, so both agree) |
| 11 | Sub-nav pill height / pitch | 22 px, 32 px pitch (10 px gap), 8 px inset | — | 24 px, 8 px gap | COPYABLE | absolute |
| 12 | Sub-nav item font | 11–12 px | — | 12 | — | same |
| 13 | Sub-nav grouping | collapsible group pills with plain, indented child rows (Media, Subprojecten; genre list under Audio) | — | every entry a pill | STRUCTURAL | not applied |
| 14 | Toolbar row height / button height / button font | 48 / 22 / 12 px, buttons 11 px apart | — | 46 / 22 / 11 px, 6 px apart | COPYABLE | absolute |
| 15 | Section header ("Alles") | 12 px | — | 11 px | COPYABLE | absolute |
| 16 | Media card | 120×80 raised box, thumbnail letterboxed, 11 px name 7 px below; ≈100 px total; 16 px grid gap | card = 26.5 % of content width | 120×140 card, 90 px thumb, two meta lines, 12 px gap | COPYABLE | absolute (CapCut's card is a fixed 120, identical to ours) |
| 17 | Media card badges | duration bottom-right 10 px, "Toegevoegd" chip top-left | — | duration, ×n usage chip | — | equivalent |
| 18 | Footer height | 39 px | — | 39 | — | same |
| 19 | Footer text | "AI-clipper" 13 px semibold accent, helper 12 px, teal CTA | — | 11 / 10 px | COPYABLE | absolute |
| 20 | Tab bar overflow arrow | 20 px chevron button at the right edge, tabs scroll | — | same | — | same |
| 21 | Content of Audio / Stickers / Effecten / Overgangen / Filters / Aanpassing / Sjablonen tabs | library grids and lists (search field, category chips, cards with download/favourite) | — | "not built yet" placeholders | BLOCKED | libraries do not exist |
| 22 | Ondertitels tab | form: Spreektaal select, Tweetalige ondertitels select, Stopwoorden toggle, "Genereren" CTA in footer | — | our auto-captions flow | STRUCTURAL | not applied in this pass |

## Right panel (video clip selected)

| # | Item | CapCut | Proportion | Ours (source) | Tag | Copied |
|---|---|---|---|---|---|---|
| 23 | Tab strip height | 42 px, filled | — | 42 | — | same |
| 24 | Tab labels | 13 px medium, 28 px between labels (14 px padding a side), active = teal text, no underline | — | 12 px, 10 px padding | COPYABLE | absolute |
| 25 | Tab set | Video · Audio · Snelheid · Animatie · Aanpassen · AI-stilering | — | Video · Audio · Speed | BLOCKED for Aanpassen (colour) and AI-stilering; Animatie exists for captions/text only | — |
| 26 | Segmented sub-tab row | 24 px well the full panel width, 14 px under the strip, raised active pill, 12 px labels | well = 96 % of panel | Seg control inside rows, 11 px | COPYABLE (font) / STRUCTURAL (placement) | font applied; the Video sub-tabs themselves (Achtergrond verwijderen, Masker, Retoucheren) are BLOCKED |
| 27 | Section header | 12 px bold, collapse chevron, reset ↺ and keyframe ◇ ‹ › icons at the right | — | 11 px bold, chevron only | COPYABLE (font) | keyframe controls BLOCKED (no keyframes in the document model) |
| 28 | Row label column | ≈ 78 px (labels at x+1, controls at x+79) | 14.7 % of panel | 92 px | COPYABLE | absolute 80 |
| 29 | Row label font | 12 px | — | 11 px | COPYABLE | absolute |
| 30 | Row pitch | 38 px | — | 22 + 16 = 38 | — | same |
| 31 | Value field + stepper | 54 px well + 16 px stepper, 22 tall | — | 68 + 10 | COPYABLE | absolute |
| 32 | Position X / Y | 68 px wells with the axis letter inside, 16 px stepper | — | letter outside, 56 px well | COPYABLE | absolute |
| 33 | Slider | 290 px, 2 px track #404040, white round knob, value field at the right | track = 55 % of panel | native `<input type=range>` | REDRAW | not applied |
| 34 | Toggle | 35×16 teal, white knob | — | 36×16 | — | same |
| 35 | Align row | 8 icon buttons 22 px tall in a raised group, last two disabled | — | 6 buttons with Unicode arrows | REDRAW | icons not drawn |
| 36 | Optional-effect sections (Mengsel, Stabiliseren, Kwaliteit verbeteren, Beeldruis, Optische stroom, AI verwijderen) | 55 px pitch, 8×8 checkbox + 12 px semibold label + chevron, Pro gem badges | — | none | BLOCKED | not representable in the export |
| 37 | Audio tab | Volume slider, Infaden/Uitfaden, Luidheid normaliseren, Spraak verbeteren, Videovertaler, Ruis verminderen, Audio scheiden, Kanaal vullen | — | mute, volume | BLOCKED beyond volume/fade | fades COPYABLE later (afade exists) |
| 38 | Snelheid tab | Standaard / Curve / Snelheidseffecten sub-tabs; slider 0.1–100× with tick stops, Duur field, pitch toggle, smooth slow-motion | — | preset buttons 0.5–2× | STRUCTURAL | not applied |
| 39 | Animatie tab | In / Uit / Combo sub-tabs, search, category chips, 6-column card grid of animations | — | rows of Seg controls | STRUCTURAL | not applied |
| 40 | Footer | 39 px, right-aligned button | — | same | — | same |

## Preview panel

| # | Item | CapCut | Proportion | Ours (source) | Tag | Copied |
|---|---|---|---|---|---|---|
| 41 | Header | 42 px, 13 px title at 12 px inset, menu icon at right | — | 42, 12 px at 16 px | COPYABLE | absolute |
| 42 | Canvas placement | flush under the header, centred, 327×582 | 56.8 % of panel width | 12 px padding all round | COPYABLE | absolute (padding 0 top, 12 sides) |
| 43 | Transport band | 69 px tall, controls centred 48 px down; time 11 px, play glyph 12 px, right-side icons 12 px | 10 % of panel height | 44 px, play 16 px | COPYABLE | absolute |
| 44 | Transport contents | time / play / ratio · fit · "Verhouding" · fullscreen | — | prev/play/next, volume · fit · ratio · fullscreen | — | equivalent |

## Timeline

| # | Item | CapCut | Proportion | Ours (source) | Tag | Copied |
|---|---|---|---|---|---|---|
| 45 | Toolbar | 32 px, 12–14 px glyphs on a 36 px pitch, three groups | — | 32, 13 px, 36 px pitch | — | same |
| 46 | Ruler | 16 px, labels 10–11 px | — | 20 px | COPYABLE | absolute |
| 47 | Track stack anchoring | tracks stack from the bottom of the panel, free space above the topmost track | — | tracks from the top | STRUCTURAL | not applied |
| 48 | Track header column | 123 px, icons only (lock, eye, mute) | 7.2 % of width | 123 px, text labels | — (REDRAW for icons) | width same |
| 49 | Left inset before t = 0 | 51 px (the "Omslag" cover button column) | — | 0 | STRUCTURAL | not applied |
| 50 | Row heights | effect/text 22, text 24, captions 24, video 74, audio 50 | — | 22 / 30 / 30 / 74 | COPYABLE | absolute 24 for captions; overlay row kept (not captured in CapCut) |
| 51 | Row gap | 3 px page colour | — | 1 px | COPYABLE | absolute |
| 52 | Block inset in a 24 px row | 3 px | — | 4 px | COPYABLE | absolute |
| 53 | Clip name strip | 17 px, 11 px name in a pill | — | 17, 10 px | COPYABLE | absolute |
| 54 | Scrollbar | 6 px, #404040, bottom | — | native | — | — |

## Not captured (no rows)

Second-level sub-tabs (Audio › Stemveranderaar; Snelheid › Curve, Snelheidseffecten; Animatie › In/Uit/Combo; Aanpassen › HSL, Curves, Kleurenwiel, Masker; Retoucheren chips), every timeline selection other than a video clip (nothing selected, effect bar, text, caption, audio clip, second clip, transition), preview-canvas selection chrome, the cover dialog, the preview menu, the top-right Pro / Deel controls, and any hover or pressed states.
