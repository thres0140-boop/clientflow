import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — debug: show all instagram connections + lead counts
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token");
  if (secret !== "zernio-migrate-2024") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?purge=clientId — wipe all DmLeads for that client so stale cross-contaminated leads are removed
  const purge = req.nextUrl.searchParams.get("purge");
  if (purge) {
    const cid = parseInt(purge);
    const { count } = await prisma.dmLead.deleteMany({ where: { clientId: cid } });
    return NextResponse.json({ ok: true, deleted: count });
  }

  // ?content=clientId — dump content pieces + tracked videos for debugging analytics
  const contentDump = req.nextUrl.searchParams.get("content");
  if (contentDump) {
    const cid = parseInt(contentDump);
    const pieces = await prisma.contentPiece.findMany({
      where: { clientId: cid },
      orderBy: { scheduledDate: "desc" }, take: 20,
    });
    const videos = await (prisma as any).trackedVideo.findMany({
      where: { clientId: cid }, orderBy: { datePosted: "desc" }, take: 20,
    }).catch(() => []);
    return NextResponse.json({
      pieces: pieces.map((p: any) => ({ title: p.title, scheduledDate: p.scheduledDate, status: p.status, igMediaId: p.igMediaId, hasRaw: !!p.rawContentUrl, concept: p.conceptId })),
      videos: videos.map((v: any) => ({ title: v.title, datePosted: v.datePosted, url: v.url, views: v.views })),
    });
  }

  // ?leads=clientId — dump lead dates for debugging analytics
  const leadsDump = req.nextUrl.searchParams.get("leads");
  if (leadsDump) {
    const cid = parseInt(leadsDump);
    const all = await prisma.dmLead.findMany({ where: { clientId: cid }, orderBy: { date: "asc" } });
    const leads = all.map((l: any) => ({
      name: l.name, status: l.status, date: l.date,
      repliedAt: l.repliedAt, linkSentAt: l.linkSentAt, bookedAt: l.bookedAt,
    }));
    return NextResponse.json({ count: leads.length, leads });
  }

  // ?fixreplied=clientId — recompute repliedAt for ALL answered leads from real message
  // timestamps, bypassing the sync's skip optimization. One-time cleanup of detection-date artifacts.
  const fixreplied = req.nextUrl.searchParams.get("fixreplied");
  if (fixreplied) {
    const cid = parseInt(fixreplied);
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
    if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account" });
    const profileId = (conn as any).zernioProfileId || process.env.ZERNIO_PROFILE_ID;
    const KEY = process.env.ZERNIO_API_KEY;
    const ymd = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
    const leads = await prisma.dmLead.findMany({ where: { clientId: cid, repliedAt: { not: null } } as any });
    let fixed = 0;
    for (const lead of leads) {
      const convId = (lead as any).convId;
      if (!convId) continue;
      try {
        const u = new URL(`https://zernio.com/api/v1/inbox/conversations/${convId}/messages`);
        u.searchParams.set("accountId", conn.zernioAccountId);
        const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
        if (!r.ok) continue;
        const d = await r.json();
        const msgs: any[] = d.messages ?? d.data ?? d.items ?? [];
        const inc = msgs.filter((m: any) => m.direction === "incoming" || m.isOwn === false || m.is_sender === false);
        const times = inc.map((m: any) => new Date(m.createdAt ?? m.sentAt ?? m.timestamp ?? m.created_at).getTime()).filter((n) => !isNaN(n));
        if (!times.length) continue;
        const first = ymd(new Date(Math.min(...times)).toISOString());
        if (first && first !== (lead as any).repliedAt) {
          await prisma.dmLead.update({ where: { id: lead.id }, data: { repliedAt: first } as any });
          fixed++;
        }
      } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: true, checked: leads.length, fixed });
  }

  // ?resync=clientId — clear lastConvTime so the next sync re-scans all conversations
  // (used to backfill corrected dates onto existing leads)
  const resync = req.nextUrl.searchParams.get("resync");
  if (resync) {
    const cid = parseInt(resync);
    const { count } = await (prisma as any).dmLead.updateMany({
      where: { clientId: cid },
      data: { lastConvTime: null },
    });
    return NextResponse.json({ ok: true, cleared: count });
  }

  // ?testconv=clientId — probe Zernio conversations endpoint and return the raw result
  const testconv = req.nextUrl.searchParams.get("testconv");
  if (testconv) {
    const cid = parseInt(testconv);
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
    if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account", conn });
    const profileId = (conn as any).zernioProfileId || process.env.ZERNIO_PROFILE_ID;
    const url = new URL("https://zernio.com/api/v1/inbox/conversations");
    url.searchParams.set("profileId", String(profileId));
    url.searchParams.set("accountId", conn.zernioAccountId);
    url.searchParams.set("platform", "instagram");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({
      requestedUrl: url.toString().replace(String(process.env.ZERNIO_API_KEY), "***"),
      profileId, accountId: conn.zernioAccountId,
      status: res.status, ok: res.ok, body: data,
    });
  }

  const rows = await (prisma as any).$queryRaw`
    SELECT c.id, c.name, ic."zernioAccountId", ic."zernioProfileId", ic."igUsername",
           (SELECT COUNT(*) FROM "DmLead" dl WHERE dl."clientId" = c.id) as "leadCount"
    FROM "Client" c
    LEFT JOIN "InstagramConnection" ic ON ic."clientId" = c.id
    ORDER BY c.name
  `;
  return NextResponse.json(rows);
}

// One-time migration endpoint — adds columns that are new in the schema.
// Call once after deploy, then this is a no-op (IF NOT EXISTS is safe to re-run).
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-secret");
  if (secret !== "zernio-migrate-2024") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await (prisma as any).$executeRaw`
      ALTER TABLE "InstagramConnection"
      ADD COLUMN IF NOT EXISTS "zernioAccountId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ContentPiece"
      ADD COLUMN IF NOT EXISTS "igMediaId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "InstagramConnection"
      ADD COLUMN IF NOT EXISTS "zernioProfileId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "InstagramConnection"
      ADD COLUMN IF NOT EXISTS "profilePictureUrl" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ContentPiece"
      ADD COLUMN IF NOT EXISTS "zernioPostId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "repliedAt" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "source" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "Client"
      ADD COLUMN IF NOT EXISTS "ctaKeyword" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "convId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "linkSentAt" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "lastConvTime" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "DmLead"
      ADD COLUMN IF NOT EXISTS "bookedAt" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "AnalyticsEntry"
      ADD COLUMN IF NOT EXISTS "videoLink" TEXT;
    `;
    return NextResponse.json({ ok: true, message: "Migration complete." });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
