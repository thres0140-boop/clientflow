import { timingSafeEqual } from "crypto";

/**
 * Guard for /api/internal/* — service-to-service entry points called by Cenks Dashboard's
 * server (never a browser). Like isAdminToken it fails closed: with INTERNAL_API_SECRET unset
 * every call is rejected. A separate secret from ADMIN_TOKEN, so the dashboard can send DMs
 * without also holding the keys to the maintenance endpoints.
 */
export const INTERNAL_TOKEN_HEADER = "x-ordo-internal-token";

export function isInternalToken(candidate: string | null | undefined): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
