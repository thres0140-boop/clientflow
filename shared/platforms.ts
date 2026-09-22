// Platform filtering for list routes that are scoped to one platform by default.
//
// Contract (shared by /api/concepts, /api/workflow, /api/script-drafts, /api/content):
//   ?platforms=instagram,tiktok  → explicit multi-platform filter, takes precedence
//   ?platform=tiktok             → single platform (legacy)
//   neither                      → "instagram" (legacy default; Kanban/Concepts/Analytics rely on it)
//
// "platforms" present but empty/garbage falls back to the legacy single-platform path, so an
// omitted or malformed param can never widen a query to "all platforms".

export type PlatformId = "instagram" | "tiktok";

export const PLATFORM_IDS: PlatformId[] = ["instagram", "tiktok"];

export function isPlatformId(v: unknown): v is PlatformId {
  return v === "instagram" || v === "tiktok";
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
