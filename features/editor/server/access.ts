// Who may touch an edit project. proxy.ts only scopes the ?clientId query param for member
// sessions, and these routes are addressed by project id, so the client check has to happen here.
import { NextRequest } from "next/server";
import { verifySessionToken, type SessionPayload } from "@/shared/auth/session";

export async function sessionFrom(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get("cf_session")?.value;
  return token ? verifySessionToken(token) : null;
}

/** Owner: everything. Member: only clients in their session (clientIds, else clientId). */
export function mayAccessClient(session: SessionPayload, clientId: number): boolean {
  if (session.type === "owner") return true;
  const allowed = Array.isArray(session.clientIds) && session.clientIds.length ? session.clientIds : session.clientId != null ? [session.clientId] : [];
  return allowed.includes(clientId);
}
