import { prisma } from "@/shared/db/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Instagram Inbox mirror — backfill, reconcile and prune against Zernio.
//
// What is mirrored: EVERY conversation row (that is what makes the list instant — ~100 list
// requests per client), and messages ONLY for threads Zernio reports with unreadCount > 0, which
// is the one place the local unread rule needs message direction. Zernio's unreadCount is used
// as a SUPERSET trigger (it increments on every incoming message, it just never clears properly),
// never as the badge. Everything else arrives by webhook; older messages load live on scroll-up.
// Retention (Neon Free, 0.5 GB): 6 months. Attachments are stored trimmed (no payload).
//
// Write strategy: conversations are upserted one by one (identity fields only ever improve);
// messages are inserted with createMany + skipDuplicates (edits/deletes/status arrive through
// the webhook). Timestamps on the conversation only ever move forward.
// ─────────────────────────────────────────────────────────────────────────────

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;          // 3,000 conversations per walk
const MESSAGES_PAGE = 25;      // per request while hunting for the last outgoing message
const MESSAGES_MAX_PAGES = 4;  // ≤ 100 messages per thread, and usually just one request
export const RETENTION_MONTHS = 6;
const THROTTLE_MS = 60;

const PLACEHOLDER = "Instagram User";
const isPlaceholder = (n: unknown) => !n || String(n).trim() === PLACEHOLDER;
const toDate = (v: unknown): Date | null => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };
const later = (a: Date | null | undefined, b: Date | null | undefined): Date | null => (!a ? b ?? null : !b ? a : a > b ? a : b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ready = false;
export async function mirrorTablesExist(): Promise<boolean> {
  if (ready) return true;
  try {
    const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('"ZernioConversation"') IS NOT NULL AND to_regclass('"ZernioMessage"') IS NOT NULL AND to_regclass('"ZernioSyncState"') IS NOT NULL AS ok`);
    ready = !!rows[0]?.ok;
  } catch { ready = false; }
  return ready;
}

// Keep only what the UI needs; `payload` (template/share blobs) is dropped.
export function trimAttachments(list: unknown): string {
  const arr = Array.isArray(list) ? list : [];
  return JSON.stringify(arr.map((a: any) => ({
    type: a?.type ?? "file", originalType: a?.originalType ?? null, url: a?.url ?? null,
    refreshUrl: a?.refreshUrl ?? null, previewUrl: a?.previewUrl ?? null, filename: a?.filename ?? null,
  })));
}

// ── Zernio fetchers (own copies; syncPipeline keeps its own) ─────────────────
async function zget(url: URL): Promise<any | null> {
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}
async function fetchConversationPage(profileId: string, accountId: string, cursor: string | null) {
  const url = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  url.searchParams.set("profileId", profileId); url.searchParams.set("accountId", accountId);
  url.searchParams.set("platform", "instagram"); url.searchParams.set("limit", String(PAGE_SIZE)); url.searchParams.set("sortOrder", "desc");
  if (cursor) url.searchParams.set("cursor", cursor);
  const data = await zget(url);
  if (!data) return null;
  return { items: (Array.isArray(data.data) ? data.data : []) as any[], nextCursor: data.pagination?.hasMore && data.pagination?.nextCursor ? String(data.pagination.nextCursor) : null };
}
async function fetchNewestMessages(conversationId: string, accountId: string, cursor: string | null): Promise<{ items: any[]; nextCursor: string | null } | null> {
  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`);
  url.searchParams.set("accountId", accountId); url.searchParams.set("limit", String(MESSAGES_PAGE)); url.searchParams.set("sortOrder", "desc");
  if (cursor) url.searchParams.set("cursor", cursor);
  const data = await zget(url);
  if (!data) return null;
  return { items: Array.isArray(data.messages) ? data.messages : [], nextCursor: data.pagination?.hasMore && data.pagination?.nextCursor ? String(data.pagination.nextCursor) : null };
}

// ── Writers ──────────────────────────────────────────────────────────────────
// One page of conversations in TWO database round trips: read the existing lastMessageAt/syncedAt
// for drift detection, then a single INSERT … ON CONFLICT with the identity-improve rules in SQL
// (a real name replaces the placeholder, picture/url/participantId are never cleared, timestamps
// only move forward). Replaces one findUnique + one upsert per row — the backfill's real cost.
export async function upsertConversationsFromList(clientId: number, accountId: string, items: any[]): Promise<Map<string, { existing: { lastMessageAt: Date | null; syncedAt: Date | null } | null; updated: Date | null }>> {
  const out = new Map<string, { existing: { lastMessageAt: Date | null; syncedAt: Date | null } | null; updated: Date | null }>();
  const rows = items.filter((c) => c?.id);
  if (!rows.length) return out;
  const ids = rows.map((c) => String(c.id));
  const existing = await prisma.zernioConversation.findMany({ where: { id: { in: ids } }, select: { id: true, lastMessageAt: true, syncedAt: true } });
  const byId = new Map(existing.map((e) => [e.id, { lastMessageAt: e.lastMessageAt, syncedAt: e.syncedAt }]));
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const c of rows) {
    const ig = c.instagramProfile ?? null;
    const updated = toDate(c.updatedTime);
    out.set(String(c.id), { existing: byId.get(String(c.id)) ?? null, updated });
    const vals = [String(c.id), clientId, accountId, c.participantId ?? null, c.participantName ? String(c.participantName) : null, c.participantPicture ?? null,
      c.status ?? "active", !!c.isGroup, c.url ?? null, typeof c.lastMessage === "string" ? c.lastMessage : null, updated, c.unreadCount ?? null,
      ig?.isFollower ?? null, ig?.isFollowing ?? null, ig?.followerCount ?? null, ig?.isVerified ?? null, ig ? (toDate(ig.fetchedAt) ?? new Date()) : null];
    const base = params.length;
    params.push(...vals);
    tuples.push("(" + vals.map((_, i) => `${base + i + 1}`).join(",") + ")");
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ZernioConversation" ("id","clientId","accountId","participantId","participantName","participantPicture","status","isGroup","url","lastMessageText","lastMessageAt","zernioUnreadCount","igIsFollower","igIsFollowing","igFollowerCount","igIsVerified","igFetchedAt","syncedAt","createdAt","updatedAt")
    SELECT v.*, now(), now(), now() FROM (VALUES ${tuples.join(",")}) AS v("id","clientId","accountId","participantId","participantName","participantPicture","status","isGroup","url","lastMessageText","lastMessageAt","zernioUnreadCount","igIsFollower","igIsFollowing","igFollowerCount","igIsVerified","igFetchedAt")
    ON CONFLICT ("id") DO UPDATE SET
      "participantId" = COALESCE(EXCLUDED."participantId", "ZernioConversation"."participantId"),
      "participantName" = CASE WHEN EXCLUDED."participantName" IS NOT NULL AND trim(EXCLUDED."participantName") <> '${PLACEHOLDER}' THEN EXCLUDED."participantName" ELSE COALESCE("ZernioConversation"."participantName", EXCLUDED."participantName") END,
      "participantPicture" = COALESCE(EXCLUDED."participantPicture", "ZernioConversation"."participantPicture"),
      "status" = EXCLUDED."status", "isGroup" = EXCLUDED."isGroup", "url" = COALESCE(EXCLUDED."url", "ZernioConversation"."url"),
      "lastMessageText" = CASE WHEN "ZernioConversation"."lastMessageAt" IS NULL OR EXCLUDED."lastMessageAt" IS NULL OR EXCLUDED."lastMessageAt" >= "ZernioConversation"."lastMessageAt" THEN COALESCE(EXCLUDED."lastMessageText", "ZernioConversation"."lastMessageText") ELSE "ZernioConversation"."lastMessageText" END,
      "lastMessageAt" = CASE WHEN "ZernioConversation"."lastMessageAt" IS NULL THEN EXCLUDED."lastMessageAt" WHEN EXCLUDED."lastMessageAt" IS NULL THEN "ZernioConversation"."lastMessageAt" ELSE GREATEST("ZernioConversation"."lastMessageAt", EXCLUDED."lastMessageAt") END,
      "zernioUnreadCount" = EXCLUDED."zernioUnreadCount",
      "igIsFollower" = COALESCE(EXCLUDED."igIsFollower", "ZernioConversation"."igIsFollower"),
      "igIsFollowing" = COALESCE(EXCLUDED."igIsFollowing", "ZernioConversation"."igIsFollowing"),
      "igFollowerCount" = COALESCE(EXCLUDED."igFollowerCount", "ZernioConversation"."igFollowerCount"),
      "igIsVerified" = COALESCE(EXCLUDED."igIsVerified", "ZernioConversation"."igIsVerified"),
      "igFetchedAt" = COALESCE(EXCLUDED."igFetchedAt", "ZernioConversation"."igFetchedAt"),
      "syncedAt" = now(), "updatedAt" = now()`, ...params);
  return out;
}

// Mirror just enough of a thread to set lastIncomingAt and lastOutgoingAt: the newest page gives
// the latest incoming message; we keep paging (25 at a time, at most 4 pages) only until the most
// recent OUTGOING message is found. Usually that is one request. If 100 messages are all incoming
// the thread is unread on any reading, and lastOutgoingAt stays unknown (null → unread).
export async function mirrorNewestMessages(clientId: number, conversationId: string, accountId: string): Promise<number> {
  const msgs: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MESSAGES_MAX_PAGES; page++) {
    const p = await fetchNewestMessages(conversationId, accountId, cursor);
    if (!p) { if (!msgs.length) return 0; break; }
    msgs.push(...p.items);
    if (p.items.some((m: any) => m?.direction === "outgoing") || !p.nextCursor) break;
    cursor = p.nextCursor;
    await sleep(THROTTLE_MS);
  }
  const rows = msgs.filter((m: any) => m?.id && toDate(m.createdAt ?? m.sentAt)).map((m: any) => ({
    id: String(m.id), conversationId, clientId,
    direction: m.direction === "outgoing" ? "outgoing" : "incoming",
    text: m.message ?? m.text ?? null,
    attachments: trimAttachments(m.attachments),
    senderId: m.senderId ?? null, senderName: m.senderName ?? null, senderUsername: null,
    sentAt: toDate(m.createdAt ?? m.sentAt)!,
    deliveryStatus: m.deliveryStatus ?? null,
    isDeleted: !!m.isDeleted,
    editedAt: toDate(m.editedAt),
  }));
  if (!rows.length) return 0;
  const res = await prisma.zernioMessage.createMany({ data: rows, skipDuplicates: true });
  const lastIn = rows.filter((r) => r.direction === "incoming").reduce<Date | null>((a, r) => later(a, r.sentAt), null);
  const lastOut = rows.filter((r) => r.direction === "outgoing").reduce<Date | null>((a, r) => later(a, r.sentAt), null);
  const existing = await prisma.zernioConversation.findUnique({ where: { id: conversationId }, select: { lastIncomingAt: true, lastOutgoingAt: true, lastMessageAt: true, participantName: true, participantId: true } });
  // A resolved sender name on an incoming message upgrades a placeholder thread name.
  const namedIncoming = msgs.find((m: any) => m.direction === "incoming" && !isPlaceholder(m.senderName));
  await prisma.zernioConversation.update({
    where: { id: conversationId },
    data: {
      lastIncomingAt: later(existing?.lastIncomingAt, lastIn),
      lastOutgoingAt: later(existing?.lastOutgoingAt, lastOut),
      lastMessageAt: later(existing?.lastMessageAt, later(lastIn, lastOut)),
      ...(namedIncoming && isPlaceholder(existing?.participantName) ? { participantName: String(namedIncoming.senderName) } : {}),
      ...(!existing?.participantId && namedIncoming?.senderId ? { participantId: String(namedIncoming.senderId) } : {}),
      syncedAt: new Date(),
    },
  });
  return res.count;
}

async function connectionFor(clientId: number) {
  const conn = await prisma.instagramConnection.findUnique({ where: { clientId } });
  if (!conn?.zernioAccountId) return null;
  return { accountId: conn.zernioAccountId, profileId: conn.zernioProfileId || PROFILE_ID };
}

export type WalkResult = { clientId: number; phase: string; pages: number; conversations: number; messagesInserted: number; done: boolean; budgetHit: boolean; skipped?: string };

// ── Backfill / full walk ─────────────────────────────────────────────────────
// Resumable: the cursor lives in ZernioSyncState. `driftOnly` (the 6-hourly full walk) only
// refetches messages for threads whose updatedTime is newer than the mirror's lastMessageAt.
export async function walkClient(clientId: number, opts: { budgetMs: number; driftOnly: boolean }): Promise<WalkResult> {
  const started = Date.now();
  const r: WalkResult = { clientId, phase: opts.driftOnly ? "full" : "backfill", pages: 0, conversations: 0, messagesInserted: 0, done: false, budgetHit: false };
  const conn = await connectionFor(clientId);
  if (!conn) return { ...r, done: true, skipped: "no_zernio_account" };
  const state = await prisma.zernioSyncState.upsert({ where: { clientId }, create: { clientId, phase: r.phase }, update: {} });
  // A backfill that already completed is not restarted by the backfill action; the full walk resumes its own cursor.
  if (!opts.driftOnly && state.phase === "live") return { ...r, done: true, skipped: "already_backfilled" };
  let cursor: string | null = state.phase === r.phase ? state.cursor ?? null : null;
  if (state.phase !== r.phase) await prisma.zernioSyncState.update({ where: { clientId }, data: { phase: r.phase, cursor: null } });

  while (r.pages < MAX_PAGES) {
    if (Date.now() - started > opts.budgetMs) { r.budgetHit = true; break; }
    const page = await fetchConversationPage(conn.profileId, conn.accountId, cursor);
    if (!page) break;
    r.pages++;
    const info = await upsertConversationsFromList(clientId, conn.accountId, page.items);
    r.conversations += info.size;
    for (const c of page.items) {
      if (Date.now() - started > opts.budgetMs) { r.budgetHit = true; break; }
      try {
        const { existing, updated } = info.get(String(c.id)) ?? { existing: null, updated: null };
        const drifted = !existing || !existing.lastMessageAt || !updated || updated > existing.lastMessageAt || !existing.syncedAt;
        // Messages only where a badge is possible: Zernio's unreadCount > 0 (a superset of truly
        // unread). Backfill fetches those once; the full walk refetches them only when drifted.
        const wantsMessages = (c.unreadCount ?? 0) > 0 && (!opts.driftOnly || drifted);
        if (wantsMessages) {
          await sleep(THROTTLE_MS);
          r.messagesInserted += await mirrorNewestMessages(clientId, String(c.id), conn.accountId);
        }
      } catch (e) { console.error("[inbox-mirror] thread error", clientId, c?.id, e instanceof Error ? e.message : e); }
    }
    if (r.budgetHit) break;
    cursor = page.nextCursor;
    await prisma.zernioSyncState.update({ where: { clientId }, data: { cursor } });
    if (!cursor) { r.done = true; break; }
  }
  if (r.done || (!r.budgetHit && r.pages >= MAX_PAGES)) {
    r.done = true;
    await prisma.zernioSyncState.update({ where: { clientId }, data: { phase: "live", cursor: null, lastFullSyncAt: new Date() } });
  }
  return r;
}

// ── Light reconcile (15 min): newest page only, refetch drifted threads ──────
export async function reconcileLight(clientId: number, budgetMs: number): Promise<WalkResult> {
  const started = Date.now();
  const r: WalkResult = { clientId, phase: "light", pages: 0, conversations: 0, messagesInserted: 0, done: false, budgetHit: false };
  const conn = await connectionFor(clientId);
  if (!conn) return { ...r, done: true, skipped: "no_zernio_account" };
  const page = await fetchConversationPage(conn.profileId, conn.accountId, null);
  if (!page) return { ...r, skipped: "conversations_failed" };
  r.pages = 1;
  const info = await upsertConversationsFromList(clientId, conn.accountId, page.items);
  r.conversations = info.size;
  for (const c of page.items) {
    if (Date.now() - started > budgetMs) { r.budgetHit = true; break; }
    try {
      const { existing, updated } = info.get(String(c.id)) ?? { existing: null, updated: null };
      const drifted = !existing || !existing.lastMessageAt || !updated || updated > existing.lastMessageAt;
      if (drifted && (c.unreadCount ?? 0) > 0) { await sleep(THROTTLE_MS); r.messagesInserted += await mirrorNewestMessages(clientId, String(c.id), conn.accountId); }
    } catch (e) { console.error("[inbox-mirror] reconcile error", clientId, c?.id, e instanceof Error ? e.message : e); }
  }
  await prisma.zernioSyncState.upsert({ where: { clientId }, create: { clientId, phase: "live", lastReconcileAt: new Date() }, update: { lastReconcileAt: new Date() } });
  r.done = !r.budgetHit;
  return r;
}

// ── Prune (monthly): idempotent, logs what it removed ────────────────────────
export async function pruneMessages(months = RETENTION_MONTHS): Promise<{ cutoff: string; removed: number }> {
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  const res = await prisma.zernioMessage.deleteMany({ where: { sentAt: { lt: cutoff } } });
  console.log(`[inbox-mirror] prune: removed ${res.count} messages older than ${cutoff.toISOString()}`);
  return { cutoff: cutoff.toISOString(), removed: res.count };
}

// ── Real sizes (pg_total_relation_size) for the report ───────────────────────
export async function mirrorSizes(): Promise<Record<string, { bytes: number; pretty: string; rows: number }>> {
  const out: Record<string, { bytes: number; pretty: string; rows: number }> = {};
  for (const t of ["ZernioConversation", "ZernioMessage", "ZernioWebhookEvent", "ZernioSyncState"]) {
    try {
      const [sz] = await prisma.$queryRawUnsafe<{ bytes: bigint; pretty: string }[]>(`SELECT pg_total_relation_size('"${t}"') AS bytes, pg_size_pretty(pg_total_relation_size('"${t}"')) AS pretty`);
      const [cnt] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`);
      out[t] = { bytes: Number(sz.bytes), pretty: sz.pretty, rows: Number(cnt.n) };
    } catch (e) { out[t] = { bytes: 0, pretty: e instanceof Error ? e.message.split("\n")[0] : String(e), rows: 0 }; }
  }
  return out;
}

// ── Reads for the inbox list ─────────────────────────────────────────────────
// Freshness: the mirror is served only when the client's backfill is complete (phase "live")
// and the last reconcile/full sync is within FRESH_MS. Otherwise the caller falls back to the
// live Zernio fetch, so a cold or half-filled mirror never looks like missing conversations.
const FRESH_MS = 45 * 60 * 1000; // three missed 15-minute reconciles

export type MirrorState = "ready" | "backfilling" | "stale" | "empty" | "not_migrated";

export async function mirrorState(clientId: number): Promise<{ state: MirrorState; syncedAt: Date | null; conversations: number }> {
  if (!(await mirrorTablesExist())) return { state: "not_migrated", syncedAt: null, conversations: 0 };
  const [state, count] = await Promise.all([
    prisma.zernioSyncState.findUnique({ where: { clientId } }),
    prisma.zernioConversation.count({ where: { clientId } }),
  ]);
  const syncedAt = later(state?.lastReconcileAt, state?.lastFullSyncAt);
  if (!count) return { state: "empty", syncedAt, conversations: 0 };
  if (!state || state.phase !== "live") return { state: "backfilling", syncedAt, conversations: count };
  if (!syncedAt || Date.now() - syncedAt.getTime() > FRESH_MS) return { state: "stale", syncedAt, conversations: count };
  return { state: "ready", syncedAt, conversations: count };
}

// The list in Zernio's own shape plus `local` (unread computed here). Unread: an incoming message
// newer than BOTH the last outgoing one and the moment the owner last opened the thread.
export async function readMirrorList(clientId: number) {
  const rows = await prisma.zernioConversation.findMany({ where: { clientId }, orderBy: { lastMessageAt: "desc" } });
  const counts = await prisma.$queryRawUnsafe<{ conversationId: string; n: number }[]>(
    `SELECT m."conversationId", count(*)::int AS n
       FROM "ZernioMessage" m JOIN "ZernioConversation" c ON c."id" = m."conversationId"
      WHERE c."clientId" = $1 AND m."direction" = 'incoming' AND NOT m."isDeleted"
        AND m."sentAt" > GREATEST(COALESCE(c."lastOutgoingAt", 'epoch'::timestamp), COALESCE(c."lastSeenAt", 'epoch'::timestamp))
      GROUP BY 1`, clientId);
  const countBy = new Map(counts.map((r) => [r.conversationId, Number(r.n)]));
  // Threads that have ANY mirrored message. For the rest, no message rows does not mean "nothing
  // unread": fall back to Zernio's hint (unreadCount > 0) unless the owner opened the thread after
  // its last message.
  const withMsgs = new Set((await prisma.$queryRawUnsafe<{ conversationId: string }[]>(
    `SELECT DISTINCT "conversationId" FROM "ZernioMessage" WHERE "clientId" = $1`, clientId)).map((r) => r.conversationId));
  return rows.map((r) => {
    const epoch = new Date(0);
    const seenAfterLast = !!r.lastSeenAt && !!r.lastMessageAt && r.lastSeenAt >= r.lastMessageAt;
    const unread = withMsgs.has(r.id) || r.lastIncomingAt
      ? (!!r.lastIncomingAt && r.lastIncomingAt > (r.lastOutgoingAt ?? epoch) && r.lastIncomingAt > (r.lastSeenAt ?? epoch))
      : ((r.zernioUnreadCount ?? 0) > 0 && !seenAfterLast);
    return {
      id: r.id, participantId: r.participantId, participantName: r.participantName ?? PLACEHOLDER,
      participantUsername: r.participantUsername, participantPicture: r.participantPicture,
      lastMessage: r.lastMessageText ?? "", updatedTime: (r.lastMessageAt ?? r.updatedAt).toISOString(),
      unreadCount: null, url: r.url, isGroup: r.isGroup, status: r.status,
      local: { unread, unreadCount: unread ? Math.max(1, countBy.get(r.id) ?? (withMsgs.has(r.id) ? 0 : (r.zernioUnreadCount ?? 0))) : 0, lastSeenAt: r.lastSeenAt?.toISOString() ?? null },
    };
  });
}

// The owner opened a thread: from now on only NEWER incoming messages count as unread.
export async function markSeen(clientId: number, conversationId: string): Promise<boolean> {
  if (!(await mirrorTablesExist())) return false;
  const res = await prisma.zernioConversation.updateMany({ where: { id: conversationId, clientId }, data: { lastSeenAt: new Date() } });
  return res.count > 0;
}

// We just sent a reply: advance lastOutgoingAt so the badge clears immediately, without waiting
// for the message.sent webhook or the next reconcile. No-op when the thread isn't mirrored.
export async function touchOutgoing(clientId: number, conversationId: string): Promise<void> {
  if (!(await mirrorTablesExist())) return;
  await prisma.zernioConversation.updateMany({ where: { id: conversationId, clientId }, data: { lastOutgoingAt: new Date(), lastMessageAt: new Date() } }).catch(() => {});
}

// ── Label stats (how many threads have a real identity) ──────────────────────
export async function labelStats(clientId: number): Promise<{ total: number; name: number; handleOnly: number; anonymous: number; anonymousWithId: number }> {
  if (!(await mirrorTablesExist())) return { total: 0, name: 0, handleOnly: 0, anonymous: 0, anonymousWithId: 0 };
  const [row] = await prisma.$queryRawUnsafe<{ total: number; name: number; handleonly: number; anonymous: number; anonymouswithid: number }[]>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE "participantName" IS NOT NULL AND trim("participantName") <> '${PLACEHOLDER}')::int AS name,
            count(*) FILTER (WHERE ("participantName" IS NULL OR trim("participantName") = '${PLACEHOLDER}') AND "participantUsername" IS NOT NULL)::int AS handleonly,
            count(*) FILTER (WHERE ("participantName" IS NULL OR trim("participantName") = '${PLACEHOLDER}') AND "participantUsername" IS NULL)::int AS anonymous,
            count(*) FILTER (WHERE ("participantName" IS NULL OR trim("participantName") = '${PLACEHOLDER}') AND "participantUsername" IS NULL AND "participantId" IS NOT NULL)::int AS anonymouswithid
       FROM "ZernioConversation" WHERE "clientId" = $1`, clientId);
  return { total: Number(row?.total ?? 0), name: Number(row?.name ?? 0), handleOnly: Number(row?.handleonly ?? 0), anonymous: Number(row?.anonymous ?? 0), anonymousWithId: Number(row?.anonymouswithid ?? 0) };
}
