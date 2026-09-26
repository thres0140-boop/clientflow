// The owner's navigation, as one definition shared by the sidebar and the embedded-mode
// manifest that Ordo posts to the Cenks Dashboard (see shared/embed.ts, OrdoNavMessage).
//
// This file must stay free of imports: the dashboard's `pnpm ordo:nav-check` loads it straight
// from this repo to compare it with its own static section list.

export type NavIcon =
  | "calendar" | "board" | "kanban" | "tasks" | "concepts" | "context" | "analytics" | "dms"
  | "inbox" | "instagram" | "youtube" | "clip" | "scissors" | "transcribe" | "team" | "messages" | "settings";

export type NavItemDef = { page: string; label: string; icon: NavIcon };

export type NavGroupDef = {
  id: "work" | "instagram" | "youtube" | "editing" | "manage";
  /** Header text as the sidebar shows it (folders carry their glyph). */
  label: string;
  /** Collapsible folders remember their open/closed state. */
  collapsible: boolean;
  /** A platform folder is only shown while that platform is on for the selected client. */
  platform?: "instagram" | "youtube";
  items: NavItemDef[];
};

/** Owner sidebar: WORK, then the platform folders, then Editing, then MANAGE — in this order. */
export const OWNER_NAV: NavGroupDef[] = [
  { id: "work", label: "WORK", collapsible: false, items: [
    { page: "pipeline", label: "Content Scheduling", icon: "calendar" },
    { page: "board", label: "Strategy Board", icon: "board" },
  ]},
  { id: "instagram", label: "📸 INSTAGRAM", collapsible: true, platform: "instagram", items: [
    { page: "kanban", label: "Script Kanban", icon: "kanban" },
    { page: "tasks", label: "Script Tasks", icon: "tasks" },
    { page: "concepts", label: "Concept Library", icon: "concepts" },
    { page: "context", label: "AI Context", icon: "context" },
    { page: "analytics", label: "Analytics", icon: "analytics" },
    { page: "dms", label: "DM Pipeline", icon: "dms" },
    { page: "iginbox", label: "Instagram Inbox", icon: "inbox" },
    { page: "instagram", label: "Instagram", icon: "instagram" },
  ]},
  { id: "youtube", label: "▶ YOUTUBE", collapsible: true, platform: "youtube", items: [
    { page: "ytkanban", label: "YouTube Kanban", icon: "youtube" },
    { page: "ytclipping", label: "Clipping", icon: "clip" },
  ]},
  { id: "editing", label: "✂ EDITING", collapsible: true, items: [
    { page: "capcut", label: "CapCut", icon: "scissors" },
    { page: "transcribe", label: "Transcribe", icon: "transcribe" },
  ]},
  { id: "manage", label: "MANAGE", collapsible: false, items: [
    { page: "team", label: "Team", icon: "team" },
    { page: "chat", label: "Messages", icon: "messages" },
    { page: "clientsettings", label: "Settings", icon: "settings" }, // this client's settings
  ]},
];

/** Page ids of one group, in sidebar order. */
export function navPages(id: NavGroupDef["id"]): string[] {
  return OWNER_NAV.find((g) => g.id === id)?.items.map((i) => i.page) ?? [];
}

/** Sidebar label per page id, for every page the owner nav lists. */
export const NAV_LABELS: Record<string, string> = Object.fromEntries(
  OWNER_NAV.flatMap((g) => g.items.map((i) => [i.page, i.label])),
);

/**
 * The groups the owner sidebar actually shows for one client: platform folders only while that
 * platform is on, and only the pages the session may open. Groups left empty are dropped.
 */
export function ownerNavFor(opts: { instagramEnabled: boolean; youtubeEnabled: boolean; allowedPages: readonly string[] }): NavGroupDef[] {
  return OWNER_NAV
    .filter((g) => !g.platform || (g.platform === "instagram" ? opts.instagramEnabled : opts.youtubeEnabled))
    .map((g) => ({ ...g, items: g.items.filter((i) => opts.allowedPages.includes(i.page)) }))
    .filter((g) => g.items.length > 0);
}
