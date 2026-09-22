import { timingSafeEqual } from "crypto";

/**
 * Guard for the maintenance endpoints (/api/admin/*, /api/r2/setup-cors, and manual
 * runs of the capture-reels cron). These sit in the PUBLIC allowlist in proxy.ts, so
 * they never reach the session gate — this token is the only thing in front of them.
 *
 * It therefore must come from the environment and never from source. The previous
 * hardcoded value shipped in a public repo, which made /api/admin/migrate (76 raw SQL
 * calls against production) reachable by anyone who read the code.
 *
 * Fails closed: with ADMIN_TOKEN unset every call is rejected, rather than falling back
 * to a default that would quietly re-open the hole.
 */
export function isAdminToken(candidate: string | null | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !candidate) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
