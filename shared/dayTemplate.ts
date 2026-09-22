// Client.dayTemplate — the recurring "which concept posts on which weekday" plan.
//
// Stored as a JSON string. Two shapes exist in the database:
//   legacy (flat, Instagram-only):   { "0": 12, "3": 7 }            weekday index (0 = Mon) → conceptId
//   current (per platform):          { "instagram": { "0": 12 }, "tiktok": { "1": 30 } }
//
// Concepts are platform-scoped, so one flat map cannot serve two platforms. The parser accepts
// both shapes and treats a flat blob as the Instagram map, so no migration is needed and no
// existing data is dropped. Writers always emit the per-platform shape.

import { isPlatformId, type PlatformId } from "@/shared/platforms";

export type DayMap = Record<number, number | null>;
export type DayTemplate = Partial<Record<PlatformId, DayMap>>;

export function parseDayTemplate(raw: string | null | undefined): DayTemplate {
  if (!raw) return {};
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec);
  // Legacy flat shape (all-numeric keys, or an empty object) → the whole blob is the Instagram map.
  if (keys.every((k) => /^\d+$/.test(k))) return { instagram: rec as DayMap };
  const out: DayTemplate = {};
  for (const k of keys) {
    const v = rec[k];
    if (isPlatformId(k) && v && typeof v === "object" && !Array.isArray(v)) out[k] = v as DayMap;
  }
  return out;
}

export function serializeDayTemplate(t: DayTemplate): string {
  return JSON.stringify(t);
}
