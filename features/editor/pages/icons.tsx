// Line icons for the editor chrome, redrawn to CapCut's glyphs (measured from a native capture,
// 2026-09-25): outline strokes of ~2 css px at a ~12.5 px optical size, distinctive silhouettes,
// and only the ACTIVE tab fills its box. Stroke = currentColor so they take the text token of
// wherever they sit; no colours of their own.
export type IconName =
  | "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions" | "filters" | "adjust" | "templates"
  | "undo" | "redo" | "split" | "trash" | "zoomIn" | "zoomOut" | "play" | "pause" | "prevFrame" | "nextFrame" | "chevron" | "import" | "retry"
  | "trimLeft" | "trimRight" | "snap"
  | "menu" | "record" | "search" | "grid" | "sort" | "filter" | "plus" | "select" | "freeze" | "mic" | "link" | "mirror"
  | "volume" | "fit" | "ratio" | "fullscreen" | "share" | "chevronRight" | "sparkle" | "layout";

const F = { fill: "currentColor", stroke: "none" } as const; // a filled part of a glyph

const P: Record<IconName, React.ReactNode> = {
  // ── tab bar (CapCut: outline, 2 px; Media's box fills when active, the triangle is solid) ──
  media: <><rect x="2" y="3.5" width="12" height="9.5" rx="2" /><path d="M6.5 6v4.5l3.5-2.25z" {...F} /></>,
  audio: <><circle cx="8" cy="8" r="6" /><ellipse cx="6.6" cy="10.2" rx="1.6" ry="1.2" {...F} /><path d="M8.2 10.2V5.2l3 1" /></>,
  text: <><path d="M2.5 3.5h6M5.5 3.5v9M4 12.5h3M10.5 3.5h3M12 3.5v9M10.5 12.5h3" /></>,
  stickers: <><path d="M10.5 2.5A6 6 0 1 0 13.5 5.5" /><path d="M10.5 2.5v2a1 1 0 0 0 1 1h2" /></>,
  effects: <><path d="M7 2.5l1.5 3 3.3.5-2.4 2.3.6 3.3L7 10l-3 1.6.6-3.3L2.2 6l3.3-.5z" /><path d="M12.5 10.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" {...F} /></>,
  transitions: <><path d="M2.5 3.5v9L8 8z" /><path d="M13.5 3.5v9L8 8z" /></>,
  captions: <><rect x="2" y="3.5" width="12" height="9.5" rx="1.5" /><path d="M6 8h4M4.5 10.5h7" /></>,
  filters: <><circle cx="6" cy="6.5" r="3.4" /><circle cx="10" cy="6.5" r="3.4" /><circle cx="8" cy="10" r="3.4" /></>,
  adjust: <><path d="M2.5 5.5h5.3M12.2 5.5h1.3M2.5 10.5h1.3M8.2 10.5h5.3" /><circle cx="10" cy="5.5" r="2" /><circle cx="6" cy="10.5" r="2" /></>,
  templates: <><path d="M8 3H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V8" /><path d="M12 1.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" {...F} /></>,
  // ── timeline toolbar (CapCut: outline 2 px; trims are bracket pairs with one side emphasised) ──
  undo: <><path d="M6 4L3 7l3 3" /><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7" /></>,
  redo: <><path d="M10 4l3 3-3 3" /><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9" /></>,
  trimLeft: <><path d="M3.5 3h3v10h-3" strokeOpacity="0.35" /><path d="M12.5 3h-3v10h3" /></>,
  split: <><path d="M3.5 3h3v10h-3" /><path d="M12.5 3h-3v10h3" /></>,
  trimRight: <><path d="M3.5 3h3v10h-3" /><path d="M12.5 3h-3v10h3" strokeOpacity="0.35" /></>,
  trash: <><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></>,
  freeze: <path d="M8 2.5l5 2v4c0 3-2.5 4.5-5 5.5-2.5-1-5-2.5-5-5.5v-4z" />,
  mic: <><rect x="6" y="1.5" width="4" height="7.5" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" /></>,
  snap: <><rect x="2" y="5" width="4" height="6" rx="1" {...F} /><rect x="10" y="5" width="4" height="6" rx="1" {...F} /><path d="M10 8H6M7.5 6.5L6 8l1.5 1.5" /></>,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8.5" /><path d="M9 11l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5L5.5 7.5" /></>,
  mirror: <><path d="M8 2v12" strokeDasharray="1.5 1.5" /><path d="M1.5 12.5L4 5.5l2.5 7M2.5 10h3" /><path d="M14.5 12.5L12 5.5l-2.5 7M13.5 10h-3" strokeOpacity="0.5" /></>,
  zoomIn: <><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2l3.3 3.3M7 5v4M5 7h4" /></>,
  zoomOut: <><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2l3.3 3.3M5 7h4" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  select: <path d="M4 2.5l8 6.5-3.5.5 2 3.5-1.5 1-2-3.5L4.5 13z" />,
  // ── transport, panels ──
  play: <path d="M5 3.5v9l7.5-4.5z" {...F} />,
  pause: <><rect x="4" y="3.5" width="3" height="9" {...F} /><rect x="9" y="3.5" width="3" height="9" {...F} /></>,
  prevFrame: <><path d="M4 3.5v9" /><path d="M12 3.5v9L6 8z" {...F} /></>,
  nextFrame: <><path d="M12 3.5v9" /><path d="M4 3.5v9L10 8z" {...F} /></>,
  chevron: <path d="M5 6.5l3 3 3-3" />,
  chevronRight: <path d="M6.5 5l3 3-3 3" />,
  import: <><path d="M8 2.5v8M5 7.5l3 3 3-3" /><path d="M3 11.5v2h10v-2" /></>,
  retry: <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 3v3h-3" /></>,
  menu: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  record: <><rect x="2" y="4.5" width="9" height="7" rx="1.5" /><path d="M11 7l3-1.5v5L11 9z" /></>,
  search: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  sort: <><path d="M3 4h10M3 8h7M3 12h4" /><path d="M12.5 8v5M10.5 11l2 2 2-2" /></>,
  filter: <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" />,
  volume: <><path d="M3 6.5h2l3-2.5v8l-3-2.5H3z" /><path d="M10.5 6a2.5 2.5 0 0 1 0 4" /></>,
  fit: <><path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" /><rect x="5.5" y="5.5" width="5" height="5" rx="1" /></>,
  ratio: <><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M6 4v8" /></>,
  fullscreen: <><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></>,
  share: <><path d="M8 2.5v8M5 5.5l3-3 3 3" /><path d="M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" /></>,
  sparkle: <><path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2z" {...F} /><path d="M12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" {...F} /></>,
  layout: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 8h12M7 8v5" /></>,
};

export function Icon({ name, size = 13, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {P[name]}
    </svg>
  );
}

/** A square icon button, the one size used across the editor's chrome. `label` is the tooltip and
 *  the accessible name. Active = CapCut's dark well behind a teal glyph. */
export function IconButton({ name, label, onClick, disabled, active, className = "" }: { name: IconName; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`h-6 w-6 inline-flex items-center justify-center rounded-[3px] transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${active ? "bg-well text-accent" : "text-ink hover:bg-surface-3"} ${className}`}>
      <Icon name={name} />
    </button>
  );
}
