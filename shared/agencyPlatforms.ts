// Platform ids for the AGENCY app (Instagram, TikTok-as-data, YouTube), and the platform filter
// contract shared by its list routes (/api/concepts, /api/workflow, /api/script-drafts, /api/content).
//
// Why a second module: `shared/platforms.ts` is imported by the AI product (app/ai, ai/), which
// must not be modified and whose `Record<PlatformId, …>` maps only know Instagram and TikTok.
// Widening the union there would break its type check, so that file is frozen for the AI product
// and the agency app uses this one. Same contract, one more platform:
//
//   ?platforms=instagram,youtube → explicit multi-platform filter, takes precedence
//   ?platform=youtube            → single platform (legacy)
//   neither                      → "instagram" (legacy default; Kanban/Concepts/Analytics rely on it)
//
// "platforms" present but empty/garbage falls back to the legacy single-platform path, so an
// omitted or malformed param can never widen a query to "all platforms".
//
// "tiktok" stays in the union because stored rows (concepts, drafts, stages, content pieces,
// day templates) still carry it; the agency UI never selects it (TikTok lives in the AI product).

export type PlatformId = "instagram" | "tiktok" | "youtube";

export const PLATFORM_IDS: PlatformId[] = ["instagram", "tiktok", "youtube"];

export function isPlatformId(v: unknown): v is PlatformId {
  return v === "instagram" || v === "tiktok" || v === "youtube";
}

/** Parse `?platforms=a,b` into a de-duplicated list of known platform ids (or null if unusable). */
export function parsePlatformsParam(raw: string | null): PlatformId[] | null {
  if (!raw) return null;
  const list = Array.from(new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(isPlatformId)));
  return list.length ? list : null;
}

/**
 * The Prisma `platform` condition for a request. Returns `{ platform: "x" }` for the legacy
 * single-platform path (byte-for-byte what the routes did before) or `{ platform: { in: [...] } }`
 * when `platforms` is given.
 */
export function platformWhere(searchParams: URLSearchParams): { platform: string } | { platform: { in: string[] } } {
  const multi = parsePlatformsParam(searchParams.get("platforms"));
  if (multi) return { platform: { in: multi } };
  return { platform: searchParams.get("platform") || "instagram" };
}
