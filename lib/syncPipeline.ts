import { prisma } from "@/lib/prisma";
import { bumpAnalytics } from "@/lib/analyticsBump";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

export const DM_STATUS_ORDER = [
  "messaged", "answered", "link_sent", "booked", "no_show", "unqualified", "no_close", "closed",
];

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function normHandle(h?: string | null) {
  return (h ?? "").replace(/^@/, "").toLowerCase().trim();
}
const idx = (s: string) => DM_STATUS_ORDER.indexOf(s);

export type SyncResult = { created: number; answered: number; ctaFound: number; linked: number; scanned: number; skipped?: string };

/**
 * Scan a client's Zernio conversations + messages and update DmLeads:
 *  - create "messaged" leads for new conversations (bumps Msgs Sent)
 *  - promote messaged → answered when the prospect replies (bumps Msgs Answered)
 *  - flag CTA-keyword inbound leads (source = "cta")
 *  - promote to link_sent when the booking link was sent (bumps Links Sent)
 * Safe to call from a page load or a cron. Idempotent — counters fire once per lead.
 */
export async function syncClientPipeline(clientId: number): Promise<SyncResult> {
  const empty: SyncResult = { created: 0, answered: 0, ctaFound: 0, linked: 0, scanned: 0 };

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const conn = await prisma.instagramConnection.findUnique({ where: { clientId } });
  if (!conn?.zernioAccountId) return { ...empty, skipped: "no_zernio_account" };

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;
  const cta = ((client as any)?.ctaKeyword ?? "").trim().toLowerCase();
  const bookingLink = (client?.bookingLink ?? "").trim();
  const today = ymd();

  // 1. Conversations
  const convUrl = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  convUrl.searchParams.set("profileId", profileId);
  convUrl.searchParams.set("accountId", conn.zernioAccountId);
  convUrl.searchParams.set("platform", "instagram");
  const convRes = await fetch(convUrl.toString(), {
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
  });
  if (!convRes.ok) return { ...empty, skipped: "conversations_failed" };
  const convData = await convRes.json();
  const conversations: any[] = convData.data ?? convData.conversations ?? convData.items ?? [];

  // 2. Existing leads — index by convId (primary) and handle (legacy fallback)
  const leads = await prisma.dmLead.findMany({ where: { clientId } });
  const leadByConv = new Map<string, any>();
  const leadByHandle = new Map<string, any>();
  for (const l of leads) {
    if ((l as any).convId) leadByConv.set((l as any).convId, l);
    const h = normHandle(l.handle);
    if (h) leadByHandle.set(h, l);
  }

  const r: SyncResult = { ...empty, scanned: Math.min(conversations.length, 30) };

  for (const conv of conversations.slice(0, 30)) {
    try {
      const convId = String(conv.id);
      const convTime = conv.updatedTime ?? conv.updatedAt ?? conv.updated_at ?? "";
      const name   = conv.participantName ?? conv.participant?.name ?? conv.name ?? "Instagram User";
      const handle = conv.participantUsername ?? conv.participant?.username ?? conv.handle ?? null;
      const h = normHandle(handle);

      // Find existing lead: by convId first, then by handle (legacy leads created before convId)
      let lead = leadByConv.get(convId) ?? (h ? leadByHandle.get(h) : null);

      if (!lead) {
        lead = await prisma.dmLead.create({
          data: { clientId, name, handle: h || null, status: "messaged", date: today, convId } as any,
        });
        leadByConv.set(convId, lead);
        if (h) leadByHandle.set(h, lead);
        await bumpAnalytics(clientId, "messagesSent", today);
        r.created++;
      } else if (!(lead as any).convId) {
        // Backfill convId on a legacy lead matched by handle (prevents future duplicates)
        await prisma.dmLead.update({ where: { id: lead.id }, data: { convId } as any });
        (lead as any).convId = convId;
        leadByConv.set(convId, lead);
      }

      // Skip the message fetch if there's nothing left to detect for this lead:
      // already replied, past the answered stage, CTA resolved, and (if link_sent) timestamp set.
      const linkTimestampDone = lead.status !== "link_sent" || (lead as any).linkSentAt;
      const nothingLeft =
        (lead as any).repliedAt &&
        idx(lead.status) >= idx("link_sent") &&
        (!cta || (lead as any).source) &&
        linkTimestampDone;
      if (nothingLeft) continue;

      // Skip if the conversation hasn't changed since we last scanned it — saves ~90%
      // of the per-conversation message fetches in steady state.
      if (convTime && (lead as any).lastConvTime === convTime) continue;

      // Messages — gentle throttle to avoid bursting Zernio's rate limit
      await new Promise((res) => setTimeout(res, 120));
      const msgUrl = new URL(`${ZERNIO_BASE}/inbox/conversations/${conv.id}/messages`);
      msgUrl.searchParams.set("accountId", conn.zernioAccountId);
      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
      });
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();
      const messages: any[] = msgData.messages ?? msgData.data ?? msgData.items ?? [];

      const incoming = messages.filter((m: any) =>
        m.direction === "incoming" || m.isOwn === false || m.is_sender === false
      );

      const patch: any = {};
      let bumpAnswered = false, bumpLink = false;
      let target = lead.status as string;

      // Upgrade anonymous lead once Zernio resolves a real name/handle
      if (h && !normHandle(lead.handle)) patch.handle = h;
      if (name && name !== "Instagram User" && (!lead.name || lead.name === "Instagram User")) patch.name = name;

      // Reply → record + promote messaged → answered
      if (incoming.length > 0) {
        if (!(lead as any).repliedAt) { patch.repliedAt = today; bumpAnswered = true; }
        if (idx(target) < idx("answered")) target = "answered";
      }
      // CTA inbound
      if (cta && !(lead as any).source &&
          incoming.some((m: any) => (m.message ?? m.text ?? "").toLowerCase().includes(cta))) {
        patch.source = "cta";
        r.ctaFound++;
      }
      // Link sent → promote to link_sent (capture the actual message timestamp)
      if (bookingLink) {
        const linkMsg = messages.find((m: any) =>
          (m.direction === "outgoing" || m.isOwn === true) && (m.message ?? m.text ?? "").includes(bookingLink)
        );
        if (linkMsg) {
          const sentAt = linkMsg.createdAt ?? linkMsg.sentAt ?? linkMsg.timestamp ?? linkMsg.created_at ?? new Date().toISOString();
          if (idx(target) < idx("link_sent")) {
            target = "link_sent";
            bumpLink = true;
            patch.linkSentAt = sentAt;
          } else if (lead.status === "link_sent" && !(lead as any).linkSentAt) {
            // Backfill timestamp for a lead already at link_sent (no double count)
            patch.linkSentAt = sentAt;
          }
        }
      }

      if (target !== lead.status) patch.status = target;

      // Mark this conversation as scanned at its current updatedTime
      if (convTime) patch.lastConvTime = convTime;

      if (Object.keys(patch).length > 0) {
        await prisma.dmLead.update({ where: { id: lead.id }, data: patch });
        if (bumpAnswered) { await bumpAnalytics(clientId, "messagesAnswered", today); r.answered++; }
        if (bumpLink)     { await bumpAnalytics(clientId, "linksSent", today); r.linked++; }
        Object.assign(lead, patch);
      }
    } catch { /* ignore per-conv errors */ }
  }

  return r;
}
