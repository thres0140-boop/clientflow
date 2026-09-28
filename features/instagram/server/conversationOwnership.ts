import { prisma } from "@/shared/db/prisma";
import { mirrorTablesExist } from "./inboxMirror";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;

// Does this Zernio conversation belong to this client's connected Instagram account?
//
// The per-conversation routes take the conversation id from the URL and the account from the
// passed clientId, and nothing ties the two together: a stale selection in the UI (or a crafted
// request) can pair conversation A with client B — on POST that sends a DM from the wrong coach's
// account. Every handler that touches a conversation on behalf of a client asks this first.
//
// Source of truth, in order:
//   1. the ZernioConversation mirror — one indexed read, and it knows the clientId directly;
//   2. when the thread is not mirrored yet (brand-new conversation before the webhook or the
//      reconcile landed, cold mirror, tables not migrated): GET /v1/inbox/conversations/{id}
//      under the client's accountId and compare the accountId Zernio reports.
// Anything that is not a positive match is a refusal. A Zernio outage during the fallback is
// reported as "unavailable" so the caller can say so, but it never lets the request through.
export type Ownership =
  | { ok: true; via: "mirror" | "zernio" }
  | { ok: false; reason: "mismatch" | "not_found" | "unavailable" };

export async function conversationBelongsToClient(clientId: number, accountId: string, conversationId: string): Promise<Ownership> {
  if (await mirrorTablesExist()) {
    const row = await prisma.zernioConversation.findUnique({ where: { id: conversationId }, select: { clientId: true } }).catch(() => null);
    if (row) return row.clientId === clientId ? { ok: true, via: "mirror" } : { ok: false, reason: "mismatch" };
  }

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${encodeURIComponent(conversationId)}`);
  url.searchParams.set("accountId", accountId);
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data = await res.json().catch(() => null);
    const reported = data?.data?.accountId;
    return typeof reported === "string" && reported === accountId ? { ok: true, via: "zernio" } : { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// Map a refusal to the HTTP answer the conversation routes give. A conversation that is not this
// client's is indistinguishable from one that does not exist: 404 either way. Only a Zernio outage
// during the fallback is told apart, as 503, so the UI can say "try again" rather than "gone".
export function ownershipRefusal(o: Extract<Ownership, { ok: false }>): { error: string; status: number } {
  return o.reason === "unavailable"
    ? { error: "ownership_check_unavailable", status: 503 }
    : { error: "conversation_not_found", status: 404 };
}
