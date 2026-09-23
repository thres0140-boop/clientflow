/**
 * Owner-only dark mode.
 *
 * The theme is a `data-theme="dark"` attribute on <html>; every colour in the app
 * resolves through the CSS custom properties in app/globals.css, which are redefined
 * under [data-theme="dark"]. Nothing forks per component.
 *
 * Persistence is localStorage (`cf_theme`, alongside the other cf_* keys). Two gates
 * keep team-member and client-account sessions light whatever is stored:
 *   1. app/layout.tsx only injects the pre-paint script when the request carries an
 *      OWNER session cookie, so a member never gets a dark first paint.
 *   2. app/page.tsx re-applies the theme once /api/auth/me resolves, forcing light for
 *      any non-owner session (covers client-side navigation after login).
 *
 * This module is imported by both server (layout) and client code — keep it free of
 * browser-only and server-only imports, and of React hooks (a hook import here breaks the
 * server build of app/layout.tsx). The live-theme hook lives in shared/useLiveTheme.ts.
 */

export const THEME_KEY = "cf_theme";
export const THEME_ATTR = "data-theme";

export type Theme = "light" | "dark";

/** Browser title-bar colour (<meta name="theme-color">) per theme. Light = the navy the
 *  installed app has always shown; dark = the dark canvas so the bar blends into the app.
 *  Next's static `viewport.themeColor` cannot follow a data attribute, so this is applied
 *  from JS together with the attribute — see applyTheme and THEME_PRE_PAINT_SCRIPT. */
export const THEME_COLOR: Record<Theme, string> = { light: "#0f1c34", dark: "#0a0c0a" };

/** Runs inline in <head> before first paint (owner sessions only). Must stay tiny and self-contained. */
export const THEME_PRE_PAINT_SCRIPT =
  `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark"){` +
  `document.documentElement.setAttribute(${JSON.stringify(THEME_ATTR)},"dark");` +
  `var m=document.querySelector('meta[name="theme-color"]');` +
  `if(m)m.setAttribute("content",${JSON.stringify(THEME_COLOR.dark)})}}catch(e){}})();`;

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Sets the attribute on <html>. Does NOT persist — use setStoredTheme for the owner's choice. */
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "dark") document.documentElement.setAttribute(THEME_ATTR, "dark");
  else document.documentElement.removeAttribute(THEME_ATTR);
  syncThemeColorMeta();
}

/** Makes <meta name="theme-color"> match the data-theme attribute. Called from applyTheme,
 *  and by the observer below on every attribute change, so the two can never drift. */
export function syncThemeColorMeta() {
  if (typeof document === "undefined") return;
  const theme: Theme = document.documentElement.getAttribute(THEME_ATTR) === "dark" ? "dark" : "light";
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "theme-color"); document.head.appendChild(meta); }
  if (meta.getAttribute("content") !== THEME_COLOR[theme]) meta.setAttribute("content", THEME_COLOR[theme]);
}

/** Keeps the title-bar colour following data-theme for the life of the page (covers an
 *  unsaved preview from Settings and any re-render that rewrites the meta tag). Returns
 *  the disconnect function; call once from the app shell. */
export function startThemeColorSync(): () => void {
  if (typeof document === "undefined") return () => {};
  syncThemeColorMeta();
  const obs = new MutationObserver(syncThemeColorMeta);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTR] });
  return () => obs.disconnect();
}

/** Persist + apply. Only ever called from the owner-only toggle in Settings. */
export function setStoredTheme(theme: Theme) {
  try {
    if (theme === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch { /* ignore */ }
  applyTheme(theme);
}
