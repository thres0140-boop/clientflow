import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/shared/db/prisma";

export const runtime = "nodejs";

// POST /api/webhooks/zernio-inbox — feeds the Instagram Inbox mirror.
//
// Register in Zernio as its OWN subscription (POST /v1/webhooks/settings) with a secret,
// profileIds = the agency profile(s), and these events:
//   message.received, message.sent, message.edited, message.deleted,
//   message.read, message.delivered, message.failed, conversation.started
//
// Envelope (flat, no `data` wrapper): { id, event, message, conversation, account, metadata, timestamp }
//   message.sender: id, name, username, picture, instagramProfile
//   conversation:   id, platformConversationId, participantId, participantName, participantUsername, participantPicture, status
//   account:        id, accountId, profileId, platform, username
//
// Order of checks, same as the hardened post webhook, and this route FAILS CLOSED:
//   1. HMAC-SHA256 over the raw body (X-Zernio-Signature) against ZERNIO_INBOX_WEBHOOK_SECRET
//   2. account.id / account.accountId must map to one of our InstagramConnections → clientId;
//      account.profileId (when present) must be one of our profiles
//   3. dedupe on X-Zernio-Event-Id via the ZernioWebhookEvent ledger
// Only then does anything get written. Nothing here reads or writes the post pipeline.

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = header.replace(/^sha256=/i, "").trim();
  const digest = createHmac("sha256", secret).update(raw, "utf8").digest();
  return [digest.toString("hex"), digest.toString("base64")].some((c) => {
    const a = Buffer.from(c), b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const PLACEHOLDER = "Instagram User";
const isPlaceholder = (n: unknown) => !n || String(n).trim() === PLACEHOLDER;
const toDate = (v: unknown): Date | null => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };
const later = (a: Date | null | undefined, b: Date | null): Date | null => (!a ? b : !b ? a : a > b ? a : b);

let mirrorReady = false;
async function mirrorTablesExist(): Promise<boolean> {
  if (mirrorReady) return true;
  try {
    const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('"ZernioConversation"') IS NOT NULL AND to_regclass('"ZernioMessage"') IS NOT NULL AS ok`);
    mirrorReady = !!rows[0]?.ok;
  } catch { mirrorReady = false; }
  return mirrorReady;
}

async function allowedProfiles(): Promise<Set<string>> {
  const env = (process.env.ZERNIO_WEBHOOK_PROFILE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const set = new Set<string>(env);
  if (process.env.ZERNIO_PROFILE_ID) set.add(process.env.ZERNIO_PROFILE_ID);
  try {
    const ig = await prisma.instagramConnection.findMany({ where: { zernioProfileId: { not: null } }, select: { zernioProfileId: true } });
    for (const c of ig) if (c.zernioProfileId) set.add(c.zernioProfileId);
  } catch { /* fall back to env only */ }
  return set;
}

type Conv = { id?: string; platformConversationId?: string; participantId?: string; participantName?: string; participantUsername?: string; participantPicture?: string; status?: string };
type Sender = { id?: string; name?: string; username?: string; picture?: string; instagramProfile?: { isFollower?: boolean | null; isFollowing?: boolean | null; followerCount?: number | null; isVerified?: boolean | null } | null };
type Msg = { id?: string; conversationId?: string; direction?: string; text?: string | null; attachments?: unknown[]; sender?: Sender; sentAt?: string; isRead?: boolean };

// Upsert the conversation row. Identity fields only ever improve: a real name replaces the
// placeholder, a username or picture is set when present and never cleared.
async function upsertConversation(clientId: number, accountId: string, conv: Conv, sender: Sender | undefined, direction: string | null, sentAt: Date | null, text: string | null | undefined) {
  const id = conv.id;
  if (!id) return;
  const existing = await prisma.zernioConversation.findUnique({ where: { id } });
  const incomingName = !isPlaceholder(conv.participantName) ? conv.participantName! : (direction === "incoming" && !isPlaceholder(sender?.name) ? sender!.name! : null);
  const incomingUsername = conv.participantUsername || (direction === "incoming" ? sender?.username : undefined) || null;
  const incomingPicture = conv.participantPicture || (direction === "incoming" ? sender?.picture : undefined) || null;
  const ig = direction === "incoming" ? sender?.instagramProfile ?? null : null;

  const data = {
    clientId, accountId,
    platformConversationId: conv.platformConversationId ?? existing?.platformConversationId ?? null,
    participantId: conv.participantId ?? sender?.id ?? existing?.participantId ?? null,
    participantName: incomingName ?? existing?.participantName ?? (conv.participantName ? String(conv.participantName) : null),
    participantUsername: incomingUsername ?? existing?.participantUsername ?? null,
    participantPicture: incomingPicture ?? existing?.participantPicture ?? null,
    status: conv.status ?? existing?.status ?? "active",
    ...(sentAt ? {
      lastMessageAt: later(existing?.lastMessageAt, sentAt),
      lastMessageText: !existing?.lastMessageAt || sentAt >= existing.lastMessageAt ? (text ?? existing?.lastMessageText ?? null) : existing.lastMessageText,
      ...(direction === "incoming" ? { lastIncomingAt: later(existing?.lastIncomingAt, sentAt) } : {}),
      ...(direction === "outgoing" ? { lastOutgoingAt: later(existing?.lastOutgoingAt, sentAt) } : {}),
    } : {}),
    ...(ig ? { igIsFollower: ig.isFollower ?? null, igIsFollowing: ig.isFollowing ?? null, igFollowerCount: ig.followerCount ?? null, igIsVerified: ig.isVerified ?? null, igFetchedAt: new Date() } : {}),
    syncedAt: new Date(),
  };
  await prisma.zernioConversation.upsert({ where: { id }, create: { id, ...data }, update: data });
}

async function upsertMessage(clientId: number, m: Msg, patch: { deliveryStatus?: string; isDeleted?: boolean; editedAt?: Date | null } = {}) {
  if (!m.id || !m.conversationId) return;
  const sentAt = toDate(m.sentAt) ?? new Date();
  const base = {
    conversationId: m.conversationId, clientId,
    direction: m.direction === "outgoing" ? "outgoing" : "incoming",
    text: m.text ?? null,
    attachments: JSON.stringify(Array.isArray(m.attachments) ? m.attachments : []),
    senderId: m.sender?.id ?? null, senderName: m.sender?.name ?? null, senderUsername: m.sender?.username ?? null,
    sentAt,
    ...patch,
  };
  await prisma.zernioMessage.upsert({ where: { id: m.id }, create: { id: m.id, ...base }, update: base });
}

export async function POST(req: NextRequest) {
  const secret = process.env.ZERNIO_INBOX_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
  if (!verifySignature(raw, sig, secret)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // 2. Scope: the account must be one of ours (this is also how the event is assigned to a client).
  const account = body.account ?? {};
  const accountIds = [account.id, account.accountId].filter(Boolean).map(String);
  if (!accountIds.length) return NextResponse.json({ ok: true, ignored: "no_account" }, { status: 202 });
  const conn = await prisma.instagramConnection.findFirst({ where: { zernioAccountId: { in: accountIds } }, select: { clientId: true, zernioAccountId: true } });
  if (!conn?.zernioAccountId) return NextResponse.json({ ok: true, ignored: "account_not_ours" }, { status: 202 });
  if (account.profileId) {
    const allowed = await allowedProfiles();
    if (allowed.size && !allowed.has(String(account.profileId))) return NextResponse.json({ ok: true, ignored: "profile_not_ours" }, { status: 202 });
  }

  if (!(await mirrorTablesExist())) return NextResponse.json({ error: "mirror_not_migrated" }, { status: 503 });

  // 3. Dedupe on the event id.
  const eventId = req.headers.get("x-zernio-event-id") ?? req.headers.get("x-late-event-id") ?? (body.id ? String(body.id) : null);
  if (eventId) {
    const ins = await prisma.zernioWebhookEvent.createMany({ data: [{ id: eventId }], skipDuplicates: true });
    if (ins.count === 0) return NextResponse.json({ ok: true, duplicate: true });
  }

  const event = String(req.headers.get("x-zernio-event") ?? body.event ?? "").toLowerCase();
  const clientId = conn.clientId;
  const conv: Conv = body.conversation ?? {};
  const msg: Msg | undefined = body.message;

  try {
    switch (event) {
      case "conversation.started":
        await upsertConversation(clientId, conn.zernioAccountId, conv, undefined, null, toDate(body.startedAt), null);
        break;
      case "message.received":
      case "message.sent": {
        if (!msg) break;
        const sentAt = toDate(msg.sentAt);
        await upsertConversation(clientId, conn.zernioAccountId, { ...conv, id: conv.id ?? msg.conversationId }, msg.sender, msg.direction ?? (event === "message.sent" ? "outgoing" : "incoming"), sentAt, msg.text);
        await upsertMessage(clientId, { ...msg, direction: msg.direction ?? (event === "message.sent" ? "outgoing" : "incoming") }, { deliveryStatus: msg.isRead ? "read" : "sent" });
        break;
      }
      case "message.edited":
        if (!msg) break;
        await upsertConversation(clientId, conn.zernioAccountId, { ...conv, id: conv.id ?? msg.conversationId }, msg.sender, msg.direction ?? null, null, undefined);
        await upsertMessage(clientId, msg, { editedAt: toDate(body.editedAt) ?? new Date() });
        break;
      case "message.deleted":
        if (!msg) break;
        await upsertConversation(clientId, conn.zernioAccountId, { ...conv, id: conv.id ?? msg.conversationId }, msg.sender, msg.direction ?? null, null, undefined);
        await upsertMessage(clientId, msg, { isDeleted: true, deliveryStatus: "deleted" });
        break;
      case "message.read":
      case "message.delivered":
      case "message.failed":
        if (!msg) break;
        await upsertConversation(clientId, conn.zernioAccountId, { ...conv, id: conv.id ?? msg.conversationId }, msg.sender, msg.direction ?? null, null, undefined);
        await upsertMessage(clientId, msg, { deliveryStatus: event.replace("message.", "") });
        break;
      default:
        return NextResponse.json({ ok: true, ignored: "event_not_handled", event });
    }
  } catch (e) {
    console.error("[zernio-inbox] handler error:", event, e);
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, event });
}
