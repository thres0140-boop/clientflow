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

  // 2. Existing leads
  const leads = await prisma.dmLead.findMany({ where: { clientId } });
  const leadByHandle = new Map<string, any>();
  for (const l of leads) { const h = normHandle(l.handle); if (h) leadByHandle.set(h, l); }

  const r: SyncResult = { ...empty, scanned: Math.min(conversations.length, 30) };

  for (const conv of conversations.slice(0, 30)) {
    try {
      const name   = conv.participantName ?? conv.participant?.name ?? conv.name ?? "Instagram User";
      const handle = conv.participantUsername ?? conv.participant?.username ?? conv.handle ?? null;
      const h = normHandle(handle);
      if (!h) continue;

      let lead = leadByHandle.get(h);
      if (!lead) {
        lead = await prisma.dmLead.create({
          data: { clientId, name, handle: h, status: "messaged", date: today },
        });
        leadByHandle.set(h, lead);
        await bumpAnalytics(clientId, "messagesSent", today);
        r.created++;
      }

      // Skip the message fetch if there's nothing left to detect for this lead:
      // already replied, already past the answered stage, and CTA either set or not configured.
      const nothingLeft =
        (lead as any).repliedAt &&
        idx(lead.status) >= idx("link_sent") &&
        (!cta || (lead as any).source);
      if (nothingLeft) continue;

      // Messages
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
      // Link sent → promote to link_sent
      if (bookingLink) {
        const sentLink = messages.some((m: any) =>
          (m.direction === "outgoing" || m.isOwn === true) && (m.message ?? m.text ?? "").includes(bookingLink)
        );
        if (sentLink && idx(target) < idx("link_sent")) { target = "link_sent"; bumpLink = true; }
      }

      if (target !== lead.status) patch.status = target;

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
