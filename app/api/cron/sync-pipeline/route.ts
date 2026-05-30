import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// Vercel Cron — runs every 5 minutes.
// For every connected client:
//   1. Fetch conversations → auto-create "messaged" leads for new DMs
//   2. Scan outgoing messages for booking link → promote to "link_sent"
export async function GET(req: NextRequest) {

  // All clients with a connected Zernio account
  const connections = await prisma.instagramConnection.findMany({
    where: { zernioAccountId: { not: null } },
  });

  let totalLeadsCreated = 0;
  let totalPromoted = 0;

  for (const conn of connections) {
    try {
      const result = await syncClient(conn.clientId, conn.zernioAccountId!);
      totalLeadsCreated += result.leadsCreated;
      totalPromoted += result.promoted;
    } catch (e) {
      console.error(`[sync-pipeline] client ${conn.clientId} error:`, e);
    }
  }

  console.log(`[sync-pipeline] done — ${totalLeadsCreated} leads created, ${totalPromoted} promoted`);
  return NextResponse.json({ ok: true, totalLeadsCreated, totalPromoted });
}

async function syncClient(clientId: number, accountId: string) {
  let leadsCreated = 0;
  let promoted = 0;

  // Fetch the client's booking link
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { bookingLink: true } });
  const bookingLink = client?.bookingLink ?? null;

  // 1. Fetch conversations from Zernio
  const url = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  url.searchParams.set("profileId", PROFILE_ID);
  url.searchParams.set("accountId", accountId);
  url.searchParams.set("platform", "instagram");

  const convRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
  });
  if (!convRes.ok) return { leadsCreated, promoted };
  const convData = await convRes.json();
  const conversations: any[] = convData.data ?? convData.conversations ?? [];

  // 2. Load existing leads + deduplicate by handle (keep most advanced status)
  const statusOrder = ["messaged", "link_sent", "booked", "no_show", "unqualified", "no_close", "closed"];
  const existing = await prisma.dmLead.findMany({ where: { clientId } });

  // Group by normalised handle, keep the one with the most advanced status
  const groupedByHandle = new Map<string, typeof existing>();
  for (const lead of existing) {
    const h = normalizeHandle(lead.handle);
    if (!h) continue;
    if (!groupedByHandle.has(h)) groupedByHandle.set(h, []);
    groupedByHandle.get(h)!.push(lead);
  }
  // Delete duplicates, keeping the winner
  const leadByHandle = new Map<string, (typeof existing)[0]>();
  for (const [h, group] of groupedByHandle) {
    if (group.length === 1) { leadByHandle.set(h, group[0]); continue; }
    // Sort by status index descending (most advanced first)
    group.sort((a, b) => statusOrder.indexOf(b.status) - statusOrder.indexOf(a.status));
    const winner = group[0];
    leadByHandle.set(h, winner);
    // Delete the rest
    const losers = group.slice(1);
    await prisma.dmLead.deleteMany({ where: { id: { in: losers.map((l) => l.id) } } });
    console.log(`[sync-pipeline] merged ${losers.length} duplicate(s) for @${h} into status=${winner.status}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const conv of conversations) {
    const name   = conv.participantName   ?? conv.name   ?? "Instagram User";
    const handle = conv.participantUsername ?? conv.handle ?? null;
    const normH  = normalizeHandle(handle);

    // --- Step A: ensure lead exists (messaged) ---
    if (normH && !leadByHandle.has(normH)) {
      const newLead = await prisma.dmLead.create({
        data: { clientId, name, handle: normH, status: "messaged", date: today },
      });
      leadByHandle.set(normH, newLead);
      leadsCreated++;
    }

    // --- Step B: scan messages for booking link sent ---
    if (!bookingLink || !normH) continue;
    const lead = leadByHandle.get(normH);
    if (!lead) continue;

    // Only scan if lead hasn't already been promoted past link_sent
    const currentIdx = statusOrder.indexOf(lead.status);
    if (currentIdx >= statusOrder.indexOf("link_sent")) continue; // already at or past link_sent

    try {
      const msgUrl = new URL(`${ZERNIO_BASE}/inbox/conversations/${conv.id}/messages`);
      msgUrl.searchParams.set("accountId", accountId);

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
      });
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();
      const msgs: any[] = msgData.messages ?? msgData.items ?? msgData.data ?? [];

      const linkSent = msgs.some(
        (m: any) =>
          (m.direction === "outgoing" || m.isOwn === true) &&
          ((m.message ?? m.text ?? "") as string).includes(bookingLink)
      );

      if (linkSent) {
        await prisma.dmLead.update({
          where: { id: lead.id },
          data: { status: "link_sent" },
        });
        leadByHandle.set(normH, { ...lead, status: "link_sent" });
        promoted++;
      }
    } catch { /* ignore per-conversation message fetch errors */ }
  }

  return { leadsCreated, promoted };
}

function normalizeHandle(h: string | null | undefined): string {
  return (h ?? "").replace(/^@/, "").toLowerCase().trim();
}
