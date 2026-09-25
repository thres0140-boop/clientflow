// Labels and export mapping for the transition types the editor offers. Every entry is an
// ffmpeg xfade transition name (checked against `ffmpeg -h filter=xfade`), which is what the
// Sandbox render plan will emit; nothing here exists that xfade cannot do.
import type { TransitionType } from "@/features/editor/model/document";

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: "Crossfade",
  fadeblack: "Fade through black",
  slideleft: "Slide left",
  slideright: "Slide right",
  slideup: "Slide up",
  slidedown: "Slide down",
  zoomin: "Zoom",
};

/** The xfade name for each type: identical, on purpose, so the render plan is a lookup. */
export const XFADE_NAME: Record<TransitionType, string> = {
  fade: "fade", fadeblack: "fadeblack", slideleft: "slideleft", slideright: "slideright", slideup: "slideup", slidedown: "slidedown", zoomin: "zoomin",
};
