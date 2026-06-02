import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bumpAnalytics } from "@/lib/analyticsBump";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

const STATUS_ORDER = ["messaged", "link_sent", "booked", "no_show", "unqualified", "no_close", "closed"];

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function normHandle(h?: string | null) {
  return (h ?? "").replace(/^@/, "").toLowerCase().trim();
}

// GET /api/zernio/sync-pipeline?clientId=X
// Server-side: scans Zernio conversations + messages and updates DmLeads
// (replied, CTA source, link sent) + analytics counters. Safe to call on page load.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const cid = parseInt(clientId);

  const client = await prisma.client.findUnique({ where: { id: cid } });
  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
  if (!conn?.zernioAccountId) return NextResponse.json({ ok: true, skipped: "no_zernio_account" });

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;
  const cta = ((client as any)?.ctaKeyword ?? "").trim().toLowerCase();
  const bookingLink = (client?.bookingLink ?? "").trim();
  const today = ymd();

  // 1. Fetch conversations
  const convUrl = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  convUrl.searchParams.set("profileId", profileId);
  convUrl.searchParams.set("accountId", conn.zernioAccountId);
  convUrl.searchParams.set("platform", "instagram");
  const convRes = await fetch(convUrl.toString(), {
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
  });
  const convData = await convRes.json();
  if (!convRes.ok) return NextResponse.json({ error: convData?.message ?? "Failed to fetch conversations" }, { status: 400 });
  const conversations: any[] = convData.data ?? convData.conversations ?? convData.items ?? [];

  // 2. Load existing leads once
  let leads = await prisma.dmLead.findMany({ where: { clientId: cid } });
  const leadByHandle = new Map<string, any>();
  for (const l of leads) { const h = normHandle(l.handle); if (h) leadByHandle.set(h, l); }

  let created = 0, replied = 0, ctaFound = 0, linked = 0;

  for (const conv of conversations.slice(0, 30)) {
    try {
      const name   = conv.participantName ?? conv.participant?.name ?? conv.name ?? "Instagram User";
      const handle = conv.participantUsername ?? conv.participant?.username ?? conv.handle ?? null;
      const h = normHandle(handle);

      // Ensure lead exists
      let lead = h ? leadByHandle.get(h) : null;
      if (!lead && h) {
        lead = await prisma.dmLead.create({
          data: { clientId: cid, name, handle, status: "messaged", date: today },
        });
        leadByHandle.set(h, lead);
        await bumpAnalytics(cid, "messagesSent", today);
        created++;
      }
      if (!lead) continue;

      // Fetch messages for this conversation
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
      // Reply
      if (incoming.length > 0 && !(lead as any).repliedAt) {
        patch.repliedAt = today;
      }
      // CTA inbound
      if (cta && !(lead as any).source &&
          incoming.some((m: any) => (m.message ?? m.text ?? "").toLowerCase().includes(cta))) {
        patch.source = "cta";
      }
      // Link sent
      let promoteLink = false;
      if (bookingLink) {
        const sentLink = messages.some((m: any) =>
          (m.direction === "outgoing" || m.isOwn) && (m.message ?? m.text ?? "").includes(bookingLink)
        );
        const curIdx = STATUS_ORDER.indexOf(lead.status);
        if (sentLink && curIdx < STATUS_ORDER.indexOf("link_sent")) {
          patch.status = "link_sent";
          promoteLink = true;
        }
      }

      if (Object.keys(patch).length > 0) {
        await prisma.dmLead.update({ where: { id: lead.id }, data: patch });
        if (patch.repliedAt) { await bumpAnalytics(cid, "messagesAnswered", today); replied++; }
        if (patch.source === "cta") ctaFound++;
        if (promoteLink) { await bumpAnalytics(cid, "linksSent", today); linked++; }
        Object.assign(lead, patch);
      }
    } catch { /* ignore per-conv errors */ }
  }

  return NextResponse.json({ ok: true, created, replied, ctaFound, linked, scanned: Math.min(conversations.length, 30) });
}
