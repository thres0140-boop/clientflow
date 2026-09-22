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
 * browser-only and server-only imports.
 */

export const THEME_KEY = "cf_theme";
export const THEME_ATTR = "data-theme";

export type Theme = "light" | "dark";

/** Runs inline in <head> before first paint (owner sessions only). Must stay tiny and self-contained. */
export const THEME_PRE_PAINT_SCRIPT =
  `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark")` +
  `document.documentElement.setAttribute(${JSON.stringify(THEME_ATTR)},"dark")}catch(e){}})();`;

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
}

/** Persist + apply. Only ever called from the owner-only toggle in Settings. */
export function setStoredTheme(theme: Theme) {
  try {
    if (theme === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch { /* ignore */ }
  applyTheme(theme);
}
