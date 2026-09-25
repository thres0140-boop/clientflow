# Dark mode: conversion convention

How every hardcoded colour in a `.tsx` file is converted so the owner's dark theme applies,
while light mode stays pixel-identical. Phase 2 established this on `shared/ui/Sidebar.tsx`
and `features/clients/pages/SettingsPage.tsx`; Phase 3 applies it mechanically to the rest.

The theme is `data-theme="dark"` on `<html>`. Every token lives in `app/globals.css`:
light values in `@theme static { … }`, dark values under `[data-theme="dark"] { … }`.
Components never fork on the theme. They only ever reference tokens.

## The one rule

**A converted utility or inline value must resolve to exactly the same light value as the
literal it replaced.** Same hex, or the same `oklch(...)` string Tailwind's own palette uses
(copy it from `node_modules/tailwindcss/theme.css`). No approximating. If no token has that
exact light value for that role, mint one. A conversion that changes light mode by one hex
is a failure.

## Step 1: classify the colour by ROLE, not by name

The same literal can mean different things in different places, and dark mode needs to
treat those differently (a `slate-100` hairline should become a faint white line; a
`slate-100` chip should become a raised dark surface). So tokens are chosen by what the
colour paints. The utility prefix tells you the role:

| Prefix | Role | Token family |
|---|---|---|
| `bg-` | fill | `surface`, `surface-2…5`, status `*-50/100/500/600`, `knob`, nav |
| `border-`, `divide-`, `ring-`, `outline-` | line | `line`, `line-2`, `line-soft`, `line-hard`, `line-focus`, status `*-200` |
| `text-`, `placeholder-` | ink | `ink`, `ink-2`, `muted`, `faint`, `ink-400…800`, status `*-500/600/700`, `on-*`, nav |
| `shadow-` | depth | `shadow-soft/lift/pop/btn/glow`, nav |

Because every candidate token for a literal has the *same* light value, picking the role
never changes light mode. It only decides what dark mode does.

## Step 2: the mapping table

Light values in the right column are byte-identical to the literal on the left.

### Neutral fills (`bg-`)

| Literal | Token | Dark |
|---|---|---|
| `bg-white` (card, panel, popover, input, list row) | `bg-surface` | `#121512` |
| `bg-white` as the KNOB of a toggle switch | `bg-knob` | `#e8ece8` |
| `bg-slate-50`, `hover:bg-slate-50` | `bg-surface-2` | `#1a1e1a` |
| `bg-slate-100`, `hover:bg-slate-100` | `bg-surface-3` | `#1f241f` |
| `bg-slate-200`, `hover:bg-slate-200` | `bg-surface-4` | `#272d27` |
| `bg-slate-300` | `bg-surface-5` | `#333a33` |
| `bg-black/NN` (modal scrim over content) | leave as is | scrims stay black |

### Neutral lines (`border-`, `ring-`, `divide-`)

| Literal | Token | Dark |
|---|---|---|
| `border-slate-100` | `border-line-soft` | `rgba(255,255,255,0.05)` |
| `border-slate-200` | `border-line-hard` | `rgba(255,255,255,0.10)` |
| `ring-slate-400` | `ring-line-focus` | `rgba(255,255,255,0.35)` |
| `ring-offset-N` (any) | add `ring-offset-surface` | Tailwind's default offset colour is `#fff` = `surface` light. Without this the offset ring stays white in dark. |
| `border-slate-50`, `divide-slate-50` | `border-line-softer`, `divide-line-softer` | `rgba(255,255,255,0.04)` |
| `border-slate-300` | `border-line-harder` | `rgba(255,255,255,0.16)` |
| `focus:ring-blue-400` | `focus:ring-info-400` | |

### Neutral text (`text-`)

`text-slate-*` does NOT equal the warm ink ramp (`ink`, `ink-2`, `muted`, `faint` are
graphite, not slate). Do not fold. Use the slate-exact tokens:

| Literal | Token | Dark |
|---|---|---|
| `text-slate-400` | `text-ink-400` | `#6f776f` |
| `text-slate-500` | `text-ink-500` | `#8a928a` |
| `text-slate-600` | `text-ink-600` | `#a3aba3` |
| `text-slate-700` | `text-ink-700` | `#cfd5cf` |
| `text-slate-800` | `text-ink-800` | `#e8ece8` |
| `text-slate-200`, `placeholder-slate-200` | `text-ink-200`, `placeholder-ink-200` | `#3a413a` |
| `text-slate-300`, `-900` | mint `ink-300` / `ink-900` when first needed | |

### `text-white` — decide by what it sits on

| Sits on | Token |
|---|---|
| `bg-accent` / `bg-accent-strong` | `text-on-accent` (dark `#06120a`, because the accent is bright green in dark) |
| `bg-ink` / `.o-btn-primary` | `text-on-ink` |
| a solid status or hue fill (`bg-ok-600`, `bg-danger-500`, `bg-hue-pink-500`, …) | `text-on-status` (dark `#0a0c0a`) |
| `bg-accent-N` (converted indigo) | `text-on-accent` |
| `bg-surface-ink-N` (converted slate-700/800 button) | `text-on-ink` |
| the sidebar (navy) | `text-nav-ink`, and `text-white/NN` → `text-nav-ink/NN` |
| an IDENTITY colour (client / workspace / member `.color`, a brand gradient) | **leave `text-white`** — the thing under it does not change with the theme |

### Status colours

Semantic family + Tailwind grade. Light = the exact palette value; dark = translucent
tint for 50/100, translucent line for 200, lighter ink for 500/600/700.

| Literal family | Token family | grades that exist |
|---|---|---|
| `green-*` | `ok-*` | 50 100 200 400 500 600 700 800 |
| `amber-*` | `warn-*` | 50 100 200 300 400 500 600 700 800 |
| `red-*` | `danger-*` | 50 100 200 300 400 500 600 700 |
| `blue-*` | `info-*` | 50 100 200 300 400 500 600 700 800 |

`bg-green-100 text-green-700` → `bg-ok-100 text-ok-700`. `hover:bg-red-100` →
`hover:bg-danger-100`. `border-amber-200` → `border-warn-200`. A grade that is not in the
list yet (e.g. `text-green-800`) is minted in BOTH the light block and the dark block
before it is used, with the exact oklch value from Tailwind's palette.

### Emerald, indigo, purple, orange, pink, rose, sky, cyan (Phase 3 rule)

1. If the literal's light value equals an existing token's light value **exactly**, use
   that token. Only indigo could match, and it does not: `--color-accent` is `#3d4aa3`,
   Tailwind's `indigo-600` is `oklch(51.1% 0.262 276.966)`. So nothing folds.
2. Emerald is not green, rose is not red, sky is not blue. Never fold across hues.
3. **Indigo is the legacy accent** (spinners, resize handles, old primary buttons). It maps
   to `accent-<grade>`: `bg-indigo-600` → `bg-accent-600`, `hover:bg-indigo-700` →
   `hover:bg-accent-700`, `text-indigo-800` → `text-accent-800`, `bg-indigo-50` →
   `bg-accent-50`. Light = Tailwind's indigo value; dark = the green accent family.
   `text-white` on `bg-accent-N` → `text-on-accent`.
4. **Every other hue is categorical** (tag colours, platform labels, diff red/green,
   chart legends), not a status. It maps 1:1 to a `hue-<name>-<grade>` token:
   `bg-emerald-100 text-emerald-700` → `bg-hue-emerald-100 text-hue-emerald-700`,
   `border-rose-200` → `border-hue-rose-200`, `text-sky-400` → `text-hue-sky-400`.
   Light = Tailwind's exact value. Dark follows one formula for every family so nothing
   is hand-tuned: 50 / 100 / 200 / 300 = the hue at 10 / 18 / 32 / 45 % alpha,
   400 / 500 = the hue, 600 / 700 / 800 = the hue's 400 / 300 / 200 (progressively
   lighter ink). `ok`, `warn`, `danger`, `info` follow the same formula.
   `text-white` on a `bg-hue-*-N` fill → `text-on-status`.
5. A grade that does not exist yet is minted in both blocks before use, with the value
   copied from `node_modules/tailwindcss/theme.css` (never typed from memory).
6. **Identity and brand colours are not theme colours.** Leave literal, whatever the
   theme: `client.color`, `workspace.color`, `member.color`, the `COLORS` picker arrays,
   the fallback `#6366f1` / `#8b5cf6` for a record without a colour, the owner avatar
   `#3b5bdb`, the Instagram brand gradients (`from-orange-400 to-pink-500`,
   `from-accent via-pink-500 to-orange-400`, `from-accent to-pink-500`), TikTok's brand
   black (`bg-black text-white` on the TikTok pages), and chart series palettes such as
   `FUNNEL_COLORS`. These are the same in both themes by design. `text-white` on top of
   them also stays.

### Page canvas vs raised fill (Phase 3 rule)

`bg-slate-50` on a **screen-height page wrapper** (`h-screen`, `min-h-screen`) is the page
background, not a raised chip. It maps to `bg-canvas-2` (light = slate-50 exactly, dark =
the canvas `#0a0c0a`) so cards stay lighter than the page in dark mode. Everywhere else
`bg-slate-50` → `bg-surface-2`. This is the clearest case of one literal, two roles.

### Media, scrims and brand black (Phase 3 rule)

Anything painted **as the backdrop of, or on top of, a thumbnail / video / image** stays
literal: `bg-black`, `bg-slate-800` / `bg-slate-900` placeholder tiles with an aspect
ratio, `bg-black/NN` scrims and badges, `from-black/NN` / `via-black/NN` gradients,
`text-white` / `text-white/NN` captions over media, `bg-white/NN` glass buttons over
media, `border-white/NN` spinners on a dark tile, and inline video-player controls
(`#000`, `#fff`, `rgba(0,0,0,.x)`). The media is the same in both themes, so its
overlays are too. Tell-tales in the class string: `absolute`, `inset-0`, `aspect-`,
`object-cover`, `object-contain`, `backdrop-blur`, `pointer-events-none`, `animate-spin`.

The exceptions are shades on a **theme surface**, which must flip: `hover:bg-black/[0.06]`
→ `hover:bg-shade/[0.06]`, `ring-black/10` → `ring-shade/10` (`--color-shade` is `#000`
light, `#fff` dark). A translucent white over a theme surface (a card on a tinted
panel: `bg-white/70`, `bg-white/80 border-white`, `hover:bg-white`) → `bg-surface/70`,
`bg-surface/80 border-surface`, `hover:bg-surface`.

A `bg-slate-700 text-white hover:bg-slate-800` neutral button (not media) →
`bg-surface-ink-3 text-on-ink hover:bg-surface-ink-2`. Likewise `bg-slate-800 text-white
hover:bg-slate-900` → `bg-surface-ink-2 text-on-ink hover:bg-surface-ink` (`surface-ink` =
slate-900, dark `#f2f5f2`).

### Glass, selected pills and placeholder gradients (Phase 3b rule)

- **Glass whose text is already an ink token follows the surface, even over media.**
  `bg-white/90 text-ink` (play buttons, "Open on IG", Retry) → `bg-surface/90 text-ink`,
  `bg-white/85 text-ink-2` → `bg-surface/85 text-ink-2`. Otherwise the dark ink would sit
  on a white pill. Glass with `text-white` or `text-white/NN` over media stays literal.
- **Glass on an accent banner** (`bg-accent text-white` → `text-on-accent`) uses the
  on-accent colour: `bg-white/20 hover:bg-white/30` → `bg-on-accent/20 hover:bg-on-accent/30`.
- **A selected pill painted like a neutral primary button** (`bg-slate-800 text-white
  border-slate-800`) → `bg-surface-ink-2 text-on-ink border-surface-ink-2`. A border that
  exists only to match the fill uses the fill's token, not a `line-*` token.
- **Placeholder gradients behind a thumbnail** (`bg-gradient-to-br from-slate-800
  to-slate-900`) are media backdrops and stay literal, like `bg-slate-900` tiles.
- **A ring that separates a badge from the card it sits on** (`ring-2 ring-white` on a
  count badge) matches the surface: `ring-surface`. Same for `ring-offset-surface`.
- `hover:border-slate-400` → `hover:border-line-focus` (same slate-400 line token as the
  focus ring). `text-slate-300` / `text-slate-900` → `text-ink-300` / `text-ink-900`.
- `violet` is a categorical hue like the others (`hue-violet-*`).
- `teal` is a categorical hue like the others: `bg-teal-50 text-teal-700` →
  `bg-hue-teal-50 text-hue-teal-700`.

### Inline v3 hexes that are neither identity nor media (Phase 3 rule)

Old Tailwind v3 hexes typed inline (`#dcfce7`, `#15803d`, `#1e293b`, `#e2e8f0`,
`#6366f1` as a chat bubble, chart status hexes) are NOT byte-equal to any v4 token, so
each gets its own exact token: `chip-posted-bg`, `chip-posted-ink`, `chip-ink`,
`fill-neutral`, `accent-legacy` (the v3 indigo `#6366f1` used for UI pills such as the own
chat bubble, day-template pills and date tags — NOT the `#6366f1` fallback for a record
without a colour, which is identity and stays literal), `chart-red` / `chart-amber` /
`chart-green` / `chart-empty`.

**Saturated status hexes in computed inline styles stay literal.** Pipeline's
`STATUS` metadata (`#16a34a` posted, `#2563eb` booked, `#f97316`, `#eab308`, `#ef4444`,
`#a855f7`) is applied as `backgroundColor: st.color` and as `st.color + "15"` (a hex
alpha suffix), which cannot take a `var()`. These are saturated and read the same on both
canvases, like identity colours. Only their light-only pastel companions (`#dcfce7`,
`#15803d`, `#1e293b`) get tokens. Glass on top of a SOLID status chip (`bg-white/20
text-white`, `text-white/80`) stays literal for the same reason.
Name them by what they paint. Do not map them to the nearest `ok-100`.

### Sidebar (navy in light, canvas-family near-black in dark)

| Literal | Token |
|---|---|
| `#0f1c34` (strip) | `var(--color-nav-strip)` |
| `#1a2f52` (nav) | `var(--color-nav)` |
| `rgba(255,255,255,0.08)` dividers | `var(--color-nav-line)` |
| `white` for active text / icons / rings | `var(--color-nav-ink)` (text), `var(--color-nav-ring)` (2px selection ring) |
| `rgba(147,197,253,A)` secondary text at any alpha | `navMuted(A)` = `rgba(var(--nav-ink-2-rgb), A)` |
| `rgba(255,255,255,A)` hover / overlay / faint ring at any alpha | `navOverlay(A)` = `rgba(var(--nav-overlay-rgb), A)` |
| `rgba(255,255,255,0.12)` ACTIVE item background | `var(--color-nav-active)` (green tint in dark) |
| `rgba(255,255,255,0.16)` active Headquarters | `var(--color-nav-active-strong)` |
| `8px 0 40px rgba(0,0,0,0.35)` peek shadow | `var(--shadow-nav-peek)` |
| Tailwind `text-white/NN`, `hover:bg-white/NN` on the nav | `text-nav-ink/NN`, `hover:bg-nav-overlay/NN` |

The hairline between sidebar and content is `inset -1px 0 0 var(--color-nav-edge)`:
`transparent` in light (invisible, no layout change), a faint white line in dark.

### Third-party components with their own stylesheet (Phase 4 rule)

A component that ships its own CSS (Excalidraw on the Strategy Board) never sees the
tokens. Theme it through its own API instead, bound to **the theme on screen**:
`useLiveTheme()` in `shared/useLiveTheme.ts` (a client-only module; `shared/theme.ts` must stay hook-free because the server layout imports it) reads the `data-theme` attribute (not
localStorage, so an unsaved preview in Settings is mirrored) and re-renders on attribute
changes via a MutationObserver. The board passes it as Excalidraw's `theme` prop, and
its in-canvas theme toggle is disabled: the theme is one owner-level setting, and a
member/client session must not be able to switch a canvas dark from inside it. The
vendored `public/excalidraw.css` is byte-identical to the package's production
stylesheet, so it carries Excalidraw's own dark theme; re-vendor it on every upgrade.

## Step 3: inline `style={{ }}` colours

Inline styles ignore the theme exactly like hardcoded utilities. Convert them the same way,
with `var(--color-…)`:

- A full colour: `backgroundColor: "#0f1c34"` → `backgroundColor: "var(--color-nav-strip)"`.
- A colour with alpha where the ALPHA varies per call site: use the rgb channel triple,
  `rgba(var(--nav-ink-2-rgb), 0.6)`. The channel tokens live in the plain `:root { }`
  block, not in `@theme`, so Tailwind does not generate bogus utilities for them. This
  form is byte-identical to the old `rgba(147,197,253,0.6)`; do NOT use
  `color-mix(...)` for inline alpha because it round-trips through oklab.
- A colour with alpha that is a fixed role (the active-item background): its own token.
- SVG icons: set `style={{ color: c }}` on the `<svg>` and use `stroke="currentColor"` /
  `fill="currentColor"`, so `c` can be a `var()`. Presentation attributes cannot be
  trusted to accept `var()` everywhere.
- A `boxShadow` literal: a `--shadow-*` token. Its light value is the literal verbatim.
- `"transparent"` and `"none"` are not colours. Leave them.
- Identity colours (`c.color`, `w.color`, `activeProfile.color`, `#6366f1` fallback): leave.

## Step 4: reuse vs mint

Reuse a token when its LIGHT value equals the literal exactly AND its role matches.
Mint when either is false. When minting:

1. Add the light value to `@theme static { }` as the literal verbatim (or the exact
   Tailwind oklch string). Name it `--color-<family>-<grade>` for palette colours and
   `--color-<role>` for one-off roles (`knob`, `nav-edge`).
2. Add the dark value to `[data-theme="dark"] { }` in the same edit. A token with no dark
   value is a bug: it silently renders light in dark mode.
3. Never put a token in `@theme` that is not a real colour (channel triples go in `:root`).

The theme block is `@theme static` on purpose. Tailwind otherwise emits only the variables
a utility uses, and a token read solely from an inline `var(--x)` would be dropped from
the stylesheet, leaving the element with no colour at all. Do not remove `static`.

## Step 5: verify light mode is unchanged

Run the proof script for the file you converted:

```
node scripts/verify-theme-light.mjs \
  bg-white=bg-surface text-slate-400=text-ink-400 hover:bg-slate-100=hover:bg-surface-3 \
  --color-nav-strip='#0f1c34' --shadow-nav-peek='8px 0 40px rgba(0,0,0,0.35)'
```

`old=new` pairs are utilities. `--token=literal` pairs are inline tokens. The script
compiles `app/globals.css` with the project's Tailwind, resolves every `var()` against the
LIGHT `:root` blocks only, and fails unless each old/new pair emits identical declarations
and each inline token equals its literal (alpha compared at 8 bits, which is what both the
CSS minifier and the browser do). It also checks the theme block is still `static`.

Then check the residue by hand. After conversion the only palette utilities left in the
file should be identity / brand colours (Step 2, item 4) and `text-white` on top of them:

```
grep -noE "(hover:|focus:|group-hover:|disabled:)?(bg|text|border|ring|from|to|via|divide|placeholder)-(white|black|slate|gray|green|emerald|amber|red|orange|blue|indigo|purple|pink)(-[0-9]{2,3})?(/[0-9]+)?" <file>
grep -noE "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9][^)]*\)|\"white\"" <file>
```

Report both counts: utilities converted / intentionally kept, inline values converted /
intentionally kept, with the reason for each kept one.

## Phase 2 tally (the pattern proof)

| File | Utilities | Inline values |
|---|---|---|
| `shared/ui/Sidebar.tsx` | 39 converted, 5 kept (`text-white` on client / workspace / member identity colours) | 56 converted (34 inside the 17 icons, 3 module constants, 19 at style sites); 3 kept (`#6366f1` ×2 member fallback, `#3b5bdb` owner avatar) |
| `features/clients/pages/SettingsPage.tsx` | 56 converted, 7 kept (Instagram brand gradients and their `text-white`) | 0 converted, 17 kept (12 `COLORS` picker swatches, `#6366f1` form default, 4 theme-preview swatches in the Appearance toggle that must depict each theme literally) |

## What renders colour outside the token system (final sweep, 2026-09-23)

Everything below stays as it is in dark mode. It is listed so nobody re-audits it.

| What | Where | Can it be themed? |
|---|---|---|
| Chart series palette `FUNNEL_COLORS` | HeadquartersPage | Yes, by minting `--color-chart-series-N` tokens; not done because a six-step purple→rose ramp reads fine on both canvases. The status bar colours already use `--color-chart-*`. |
| Video-player chrome: black backdrops, white controls, `rgba(0,0,0,.x)` chips, the seek bar's `accentColor` | BoardPage tile overlays, `app/play/page.tsx` (the iframe player embedded on the board) | Deliberately not: a video player is black with white controls in every theme. |
| Excalidraw canvas and UI | BoardPage, `public/excalidraw.css` | Yes, and it is: the `theme` prop is bound to `useLiveTheme()`. The rectangle "tile" elements created under each video (`#0f1c34` / `#6366f1`) are Excalidraw element data, hidden under the real video overlays. |
| Modal scrims (`bg-black/40`, `bg-[rgba(17,17,19,0.28)]`) and image-viewer backdrops | every modal | Could read a `--color-scrim` token; kept black on purpose so dialogs read the same way in both themes. |
| Identity colours: client / workspace / member `.color`, `COLORS` / `MEMBER_COLORS` pickers, `#6366f1` / `#8b5cf6` fallbacks, `#3b5bdb` owner avatar | Sidebar, Settings, Team, Chat, Kanban, Pipeline, Concepts, `shared/types.ts` | No: they identify a record, not the UI. |
| Instagram brand gradients, TikTok brand black | Settings, Pipeline, Instagram, TikTok pages | No: brand. |
| Saturated status hexes in Pipeline's `STATUS` metadata (applied as `st.color` and `st.color + "15"`) | Pipeline | Only by dropping the hex-alpha-suffix trick; the saturated values read fine on both canvases, and their pastel companions already use `--color-chip-*`. |
| PWA `theme_color` / `background_color` (`#0f1c34`) and the viewport `themeColor` | `app/manifest.ts`, `app/layout.tsx` | Partly: Next's viewport `themeColor` accepts only `prefers-color-scheme` media queries, not an attribute, so it cannot follow the owner's toggle. The manifest is static. Both stay the navy the OS title bar has always had. |
| ORDO wordmark icon colours | `app/icons/[size]/route.tsx` | No: brand asset. |
| Light base styles in `app/globals.css` (`::selection`, focus outline, scrollbar) | globals.css | Already themed: each has a `[data-theme="dark"]` override directly above. |
| The five public routes (login, owner, invite, upload, review) | `app/*` | Not applicable: no owner session exists there, so the pre-paint script never runs. Untouched. |

Residue after the sweep, by convention reason (every remaining palette utility in a
component is one of these): scrim / media backdrop / brand black, caption or glass with
white text over media, white text on an identity or status colour set via `style`,
media placeholder tiles and gradients, spinners over media, Instagram brand gradients.
`shared/types.ts` (the DM and script status badge classes) was the one real miss the
sweep found and is converted.

## The video editor is an exception (2026-09-25)

`/edit/<draftId>` (`features/editor/pages/EditorPage.tsx`, root element class `editor-theme`)
does NOT follow the owner's theme and does NOT use ORDO's dark palette. It is always dark, on
CapCut's mid-grey-on-dark palette, because a video editor's chrome must read as neutral around
the picture and its panels must be visibly lighter than the gaps between them, which
ORDO's near-black surfaces on a near-black canvas are not. A later conversion pass must leave
this in place. It is built the same way as the theme itself, so nothing in the editor's
components breaks the rules above:

- Every editor component uses only the standard utilities (`bg-surface`, `text-ink`,
  `border-line`, `bg-accent`, hue and status families, `o-btn-*`). No hardcoded colours, no
  minted utilities. The palette is a **scoped token override**, not a class set.
- `app/globals.css` adds `.editor-theme` to the `[data-theme="dark"]` selector list, so the
  editor subtree inherits every dark token whatever `<html>` says (that is what forces dark for
  a light-mode owner or a member login, without touching the html attribute, the pre-paint
  script, `useLiveTheme()` or any other page). No value in that block changed.
- A separate `.editor-theme { … }` block, declared after the dark block, then redefines the
  neutral families (`canvas`, `surface`, `surface-2…5`, `surface-hover`, `line*`, `ink`, `ink-2`,
  `muted`, `faint`, `on-ink`, `knob`, `shade`), the accent family (`accent`, `accent-strong`,
  `accent-tint`, `on-accent`: teal), the panel shadows and the scrollbar/selection rules. Status
  and hue families are inherited from the dark block unchanged. `color-scheme: dark` makes
  native inputs match.
- The relationship that matters is the tier order **page gap → panel → raised → raised-hover**
  (`#1a1a1a → #262626 → #333333 → #3a3a3a`); tune values, keep the order.
- Media chrome inside the editor (the black preview backdrop, white text over thumbnails, the
  failed-clip chips) stays literal, exactly as the media rule above says.
- Scope: the editor route only. The CapCut list page in the sidebar is a normal app page on
  the app theme. Nothing outside the editor root carries the class, so the rest of the app is
  untouched in both themes.
