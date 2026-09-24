import { SignJWT, jwtVerify } from "jose";

// AI product sessions are signed with THEIR OWN secret. No fallback: with AI_SESSION_SECRET
// unset, signing throws (login fails closed) and verification returns null.
function getSecret(): Uint8Array {
  const s = process.env.AI_SESSION_SECRET;
  if (!s) throw new Error("AI_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  type: "owner" | "member";
  memberId: number | null;
  name: string;
  clientId?: number | null; // member's assigned client — used to scope data access
  clientIds?: number[];      // all projects this member can access (shared-email grouping)
};

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
