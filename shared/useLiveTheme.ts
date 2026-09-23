"use client";

import { useSyncExternalStore } from "react";
import { THEME_ATTR, type Theme } from "@/shared/theme";

/** The theme currently ON SCREEN: the data-theme attribute, not localStorage. An unsaved
 *  preview in Settings changes the attribute without writing storage, and anything that
 *  mirrors the theme (e.g. the Excalidraw board) must follow what is visible. Re-renders on
 *  attribute changes via a MutationObserver; "light" during SSR and for every non-owner. */
export function useLiveTheme(): Theme {
  return useSyncExternalStore(subscribeToTheme, readLiveTheme, () => "light");
}
function readLiveTheme(): Theme {
  return document.documentElement.getAttribute(THEME_ATTR) === "dark" ? "dark" : "light";
}
function subscribeToTheme(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTR] });
  return () => obs.disconnect();
}
