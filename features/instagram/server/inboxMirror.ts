import { prisma } from "@/shared/db/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Instagram Inbox mirror — backfill, reconcile and prune against Zernio.
//
// Retention (Neon Free, 0.5 GB): messages are mirrored for a rolling 6 MONTHS and at most
// the newest 100 per thread; conversation rows are kept forever; older messages load live on
// scroll-up in the thread view. Attachments are stored trimmed (no payload).
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
const MESSAGES_PER_THREAD = 100;
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
async function fetchNewestMessages(conversationId: string, accountId: string): Promise<any[] | null> {
  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`);
  url.searchParams.set("accountId", accountId); url.searchParams.set("limit", String(MESSAGES_PER_THREAD)); url.searchParams.set("sortOrder", "desc");
  const data = await zget(url);
  if (!data) return null;
  return Array.isArray(data.messages) ? data.messages : [];
}

// ── Writers ──────────────────────────────────────────────────────────────────
// From the LIST shape (participantName/Picture, lastMessage string, updatedTime, unreadCount, url,
// isGroup, instagramProfile). No username here — the list endpoint has none.
export async function upsertConversationFromList(clientId: number, accountId: string, c: any) {
  const id = String(c.id);
  const existing = await prisma.zernioConversation.findUnique({ where: { id } });
  const updated = toDate(c.updatedTime);
  const ig = c.instagramProfile ?? null;
  const data = {
    clientId, accountId,
    participantId: c.participantId ?? existing?.participantId ?? null,
    participantName: !isPlaceholder(c.participantName) ? String(c.participantName) : (existing?.participantName ?? (c.participantName ? String(c.participantName) : null)),
    participantPicture: c.participantPicture ?? existing?.participantPicture ?? null,
    status: c.status ?? existing?.status ?? "active",
    isGroup: !!c.isGroup,
    url: c.url ?? existing?.url ?? null,
    lastMessageText: typeof c.lastMessage === "string" && (!existing?.lastMessageAt || !updated || updated >= existing.lastMessageAt) ? c.lastMessage : (existing?.lastMessageText ?? null),
    lastMessageAt: later(existing?.lastMessageAt, updated),
    zernioUnreadCount: c.unreadCount ?? null,
    ...(ig ? { igIsFollower: ig.isFollower ?? null, igIsFollowing: ig.isFollowing ?? null, igFollowerCount: ig.followerCount ?? null, igIsVerified: ig.isVerified ?? null, igFetchedAt: toDate(ig.fetchedAt) ?? new Date() } : {}),
    syncedAt: new Date(),
  };
  await prisma.zernioConversation.upsert({ where: { id }, create: { id, ...data }, update: data });
  return { existing, updated };
}

// Mirror the newest page of a thread and advance the conversation's direction timestamps.
export async function mirrorNewestMessages(clientId: number, conversationId: string, accountId: string): Promise<number> {
  const msgs = await fetchNewestMessages(conversationId, accountId);
  if (!msgs) return 0;
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
    for (const c of page.items) {
      if (Date.now() - started > opts.budgetMs) { r.budgetHit = true; break; }
      try {
        const { existing, updated } = await upsertConversationFromList(clientId, conn.accountId, c);
        r.conversations++;
        const drifted = !existing || !existing.lastMessageAt || !updated || updated > existing.lastMessageAt || !existing.syncedAt;
        if (!opts.driftOnly || drifted) {
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
  for (const c of page.items) {
    if (Date.now() - started > budgetMs) { r.budgetHit = true; break; }
    try {
      const { existing, updated } = await upsertConversationFromList(clientId, conn.accountId, c);
      r.conversations++;
      const drifted = !existing || !existing.lastMessageAt || !updated || updated > existing.lastMessageAt;
      if (drifted) { await sleep(THROTTLE_MS); r.messagesInserted += await mirrorNewestMessages(clientId, String(c.id), conn.accountId); }
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
  return rows.map((r) => {
    const epoch = new Date(0);
    const unread = !!r.lastIncomingAt && r.lastIncomingAt > (r.lastOutgoingAt ?? epoch) && r.lastIncomingAt > (r.lastSeenAt ?? epoch);
    return {
      id: r.id, participantId: r.participantId, participantName: r.participantName ?? PLACEHOLDER,
      participantUsername: r.participantUsername, participantPicture: r.participantPicture,
      lastMessage: r.lastMessageText ?? "", updatedTime: (r.lastMessageAt ?? r.updatedAt).toISOString(),
      unreadCount: null, url: r.url, isGroup: r.isGroup, status: r.status,
      local: { unread, unreadCount: unread ? Math.max(1, countBy.get(r.id) ?? 0) : 0, lastSeenAt: r.lastSeenAt?.toISOString() ?? null },
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
