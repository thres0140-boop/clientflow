// Small line icons for the editor chrome (tab bar, toolbar, panels). 16 px, stroke = currentColor
// so they take the text token of wherever they sit; no colours of their own.
export type IconName =
  | "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions" | "filters" | "adjust" | "templates"
  | "undo" | "redo" | "split" | "trash" | "zoomIn" | "zoomOut" | "play" | "pause" | "prevFrame" | "nextFrame" | "chevron" | "import" | "retry"
  | "trimLeft" | "trimRight" | "snap"
  | "menu" | "record" | "search" | "grid" | "sort" | "filter" | "plus" | "select" | "freeze" | "mic" | "link" | "mirror"
  | "volume" | "fit" | "ratio" | "fullscreen" | "share" | "chevronRight" | "sparkle" | "layout";

const P: Record<IconName, React.ReactNode> = {
  media: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M6.5 6.5v3l3-1.5z" /></>,
  audio: <><path d="M3 6.5h2l3-2.5v8l-3-2.5H3z" /><path d="M10.5 6a2.5 2.5 0 010 4M12.5 4.5a4.5 4.5 0 010 7" /></>,
  text: <><path d="M3 4h10M8 4v9M6 13h4" /></>,
  stickers: <><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M13.5 9.5c-2.5 0-4 1.5-4 4" /><path d="M6 7h.01M10 7h.01" /></>,
  effects: <><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" /><path d="M12.5 11.5v2M11.5 12.5h2" /></>,
  transitions: <><rect x="2" y="4" width="6" height="8" rx="1" /><rect x="8" y="4" width="6" height="8" rx="1" /><path d="M8 4v8" /></>,
  captions: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M4.5 9.5h4M10 9.5h1.5M4.5 7h1.5M7.5 7h4" /></>,
  filters: <><circle cx="6" cy="8" r="4" /><circle cx="10" cy="8" r="4" /></>,
  adjust: <><path d="M3 5h10M3 11h10" /><circle cx="6" cy="5" r="1.5" /><circle cx="10" cy="11" r="1.5" /></>,
  templates: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M6.5 6.5v7" /></>,
  undo: <><path d="M6 4L3 7l3 3" /><path d="M3 7h6.5a3.5 3.5 0 010 7H7" /></>,
  redo: <><path d="M10 4l3 3-3 3" /><path d="M13 7H6.5a3.5 3.5 0 000 7H9" /></>,
  split: <><circle cx="4.5" cy="4" r="1.8" /><circle cx="4.5" cy="12" r="1.8" /><path d="M6 5.2L14 12M6 10.8L14 4" /></>,
  trash: <><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></>,
  zoomIn: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5M7 5v4M5 7h4" /></>,
  zoomOut: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5M5 7h4" /></>,
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="4" y="3.5" width="3" height="9" fill="currentColor" stroke="none" /><rect x="9" y="3.5" width="3" height="9" fill="currentColor" stroke="none" /></>,
  prevFrame: <><path d="M4 3.5v9" /><path d="M12 3.5v9L6 8z" fill="currentColor" stroke="none" /></>,
  nextFrame: <><path d="M12 3.5v9" /><path d="M4 3.5v9L10 8z" fill="currentColor" stroke="none" /></>,
  chevron: <path d="M5 6.5l3 3 3-3" />,
  import: <><path d="M8 2.5v8M5 7.5l3 3 3-3" /><path d="M3 11.5v2h10v-2" /></>,
  retry: <><path d="M13 8a5 5 0 11-1.5-3.6" /><path d="M13 3v3h-3" /></>,
  trimLeft: <><path d="M8 2.5v11" /><rect x="9.5" y="5" width="4.5" height="6" rx="1" /><path d="M2 8h4M4 6l2 2-2 2" /></>,
  trimRight: <><path d="M8 2.5v11" /><rect x="2" y="5" width="4.5" height="6" rx="1" /><path d="M14 8h-4M12 6l-2 2 2 2" /></>,
  snap: <><path d="M4 2.5v6a4 4 0 008 0v-6" /><path d="M4 2.5h2.5M9.5 2.5H12M4 6h2.5M9.5 6H12" /></>,
  menu: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
  record: <><rect x="2" y="4.5" width="9" height="7" rx="1.5" /><path d="M11 7l3-1.5v5L11 9z" /></>,
  search: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  sort: <><path d="M3 4h10M3 8h7M3 12h4" /><path d="M12.5 8v5M10.5 11l2 2 2-2" /></>,
  filter: <path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" />,
  plus: <path d="M8 3v10M3 8h10" />,
  select: <><path d="M4 2.5l8 6.5-3.5.5 2 3.5-1.5 1-2-3.5L4.5 13z" /></>,
  freeze: <><path d="M8 2v12M3 5l10 6M3 11l10-6" /></>,
  mic: <><rect x="6" y="1.5" width="4" height="7.5" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></>,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 5l1.5-1.5a2.5 2.5 0 013.5 3.5L10.5 8.5" /><path d="M9 11l-1.5 1.5a2.5 2.5 0 01-3.5-3.5L5.5 7.5" /></>,
  mirror: <><path d="M8 2v12" strokeDasharray="1.5 1.5" /><path d="M6 4L2.5 8 6 12zM10 4l3.5 4L10 12z" /></>,
  volume: <><path d="M3 6.5h2l3-2.5v8l-3-2.5H3z" /><path d="M10.5 6a2.5 2.5 0 010 4" /></>,
  fit: <><path d="M2.5 6V3.5a1 1 0 011-1H6M10 2.5h2.5a1 1 0 011 1V6M13.5 10v2.5a1 1 0 01-1 1H10M6 13.5H3.5a1 1 0 01-1-1V10" /><rect x="5.5" y="5.5" width="5" height="5" rx="1" /></>,
  ratio: <><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M6 4v8" /></>,
  fullscreen: <><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></>,
  share: <><path d="M8 2.5v8M5 5.5l3-3 3 3" /><path d="M3 9.5v3a1 1 0 001 1h8a1 1 0 001-1v-3" /></>,
  chevronRight: <path d="M6.5 5l3 3-3 3" />,
  sparkle: <><path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2z" /><path d="M12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></>,
  layout: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 8h12M7 8v5" /></>,
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {P[name]}
    </svg>
  );
}

/** A square icon button, the one size used across the editor's chrome. `label` is the tooltip and the accessible name. */
export function IconButton({ name, label, onClick, disabled, active, className = "" }: { name: IconName; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${active ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink"} ${className}`}>
      <Icon name={name} />
    </button>
  );
}
