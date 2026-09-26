// Embedded mode: Ordo rendered inside the Cenks Dashboard iframe.
//
// The dashboard loads Ordo with ?embed=1. The flag is persisted in sessionStorage so it
// survives the login redirect and in-app navigation, and Ordo then hides its own sidebar
// and mirrors its navigation to the parent window via postMessage.

export const EMBED_STORAGE_KEY = "cf_embed";

/** Message posted to the parent window on every navigation while embedded. */
export type OrdoNavigateMessage = {
  type: "ordo:navigate";
  page: string;
  clientId: number | null;
  /** Ordo-relative path that reopens this exact screen, e.g. "/?page=kanban&clientId=3". */
  path: string;
};

/** Posted to the parent whenever the client list is (re)loaded, so its client switcher matches Ordo. */
export type OrdoClientsMessage = {
  type: "ordo:clients";
  clients: { id: number; name: string; color: string; platform: string; workspace: string | null; instagramEnabled?: boolean; youtubeEnabled?: boolean }[];
};

/**
 * Posted to the parent once the app is ready and whenever the owner's sidebar would change (client
 * switch, platform toggles): the groups and items Ordo itself shows, so the dashboard can render the
 * same menu without a deploy. Only ever sent in embedded mode; standalone Ordo never posts it.
 */
export type OrdoNavMessage = {
  type: "ordo:nav";
  version: 1;
  groups: { id: string; label: string; collapsible: boolean; items: { page: string; label: string; icon: string }[] }[];
};

/** Message the parent may post to Ordo to change screens without reloading the iframe. */
export type ParentNavigateMessage = {
  type: "ordo:navigate";
  page?: string;
  clientId?: number | null;
  draft?: number | null;
};

/** Reads ?embed=1 / ?embed=0 (persisting the choice) and returns whether we are embedded. */
export function readEmbedFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const embed = new URLSearchParams(window.location.search).get("embed");
    if (embed === "1") { sessionStorage.setItem(EMBED_STORAGE_KEY, "1"); return true; }
    if (embed === "0") { sessionStorage.removeItem(EMBED_STORAGE_KEY); return false; }
    return sessionStorage.getItem(EMBED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export type DeepLink = { page: string | null; clientId: number | null; draft: number | null };

/** Deep-link params from the current URL: ?page=<id>&clientId=<n>&draft=<n>. */
export function parseDeepLink(isPage: (p: string) => boolean): DeepLink {
  if (typeof window === "undefined") return { page: null, clientId: null, draft: null };
  try {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page");
    const clientId = parseInt(params.get("clientId") || "", 10);
    const draft = parseInt(params.get("draft") || "", 10);
    return {
      page: page && isPage(page) ? page : null,
      clientId: Number.isFinite(clientId) ? clientId : null,
      draft: Number.isFinite(draft) ? draft : null,
    };
  } catch {
    return { page: null, clientId: null, draft: null };
  }
}

/** Builds the search string that reopens a screen, e.g. "?page=kanban&clientId=3&embed=1". */
export function buildDeepLinkSearch(opts: { page: string; clientId: number | null; embedded: boolean }) {
  const params = new URLSearchParams();
  params.set("page", opts.page);
  if (opts.clientId != null) params.set("clientId", String(opts.clientId));
  if (opts.embedded) params.set("embed", "1");
  return `?${params.toString()}`;
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
