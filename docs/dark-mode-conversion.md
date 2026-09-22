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
| `border-slate-300` | mint `line-harder` when first needed (light = slate-300 oklch) | |

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
| `text-slate-300`, `-900` | mint `ink-300` / `ink-900` when first needed | |

### `text-white` — decide by what it sits on

| Sits on | Token |
|---|---|
| `bg-accent` / `bg-accent-strong` | `text-on-accent` (dark `#06120a`, because the accent is bright green in dark) |
| `bg-ink` / `.o-btn-primary` | `text-on-ink` |
| a solid status fill (`bg-ok-600`, `bg-danger-500`, …) | `text-on-status` (dark `#0a0c0a`) |
| the sidebar (navy) | `text-nav-ink`, and `text-white/NN` → `text-nav-ink/NN` |
| an IDENTITY colour (client / workspace / member `.color`, a brand gradient) | **leave `text-white`** — the thing under it does not change with the theme |

### Status colours

Semantic family + Tailwind grade. Light = the exact palette value; dark = translucent
tint for 50/100, translucent line for 200, lighter ink for 500/600/700.

| Literal family | Token family | grades that exist |
|---|---|---|
| `green-*` | `ok-*` | 50 100 200 500 600 700 |
| `amber-*` | `warn-*` | 50 100 200 400 500 600 700 |
| `red-*` | `danger-*` | 50 100 200 400 500 600 700 |
| `blue-*` | `info-*` | 50 100 200 500 600 700 |

`bg-green-100 text-green-700` → `bg-ok-100 text-ok-700`. `hover:bg-red-100` →
`hover:bg-danger-100`. `border-amber-200` → `border-warn-200`. A grade that is not in the
list yet (e.g. `text-green-800`) is minted in BOTH the light block and the dark block
before it is used, with the exact oklch value from Tailwind's palette.

### Emerald, indigo, purple, orange, pink, and any other palette colour

1. If the literal's light value equals an existing token's light value **exactly**, use
   that token. Only indigo can match: `--color-accent` is `#3d4aa3` and
   `--color-accent-strong` is `#2f3a86`. Tailwind's `indigo-600` is
   `oklch(51.1% 0.262 276.966)`, which is NOT `#3d4aa3`, so `bg-indigo-600` does NOT map
   to `bg-accent`. It is minted (see 3).
2. Emerald is not green. `text-emerald-600` never becomes `text-ok-600`.
3. Otherwise mint a token whose light value is the literal verbatim, named by role +
   family + grade so the mapping stays mechanical: e.g. `--color-ok-alt-600` for
   emerald-600 (dark `#34d399`), `--color-accent-600` for indigo-600 (dark `#22c55e`
   only if it is used as a primary action; otherwise a lighter indigo `#818cf8`).
   Add the light and the dark value in the same edit, and document the pair in this table.
4. **Identity and brand colours are not theme colours.** Leave literal, whatever the
   theme: `client.color`, `workspace.color`, `member.color`, the `COLORS` picker array in
   SettingsPage, the fallback `#6366f1` for a member without a colour, the owner avatar
   `#3b5bdb`, and the Instagram / TikTok brand gradients
   (`from-orange-400 to-pink-500`, `from-accent via-pink-500 to-orange-400`). These are
   the same in both themes by design. `text-white` on top of them also stays.

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
