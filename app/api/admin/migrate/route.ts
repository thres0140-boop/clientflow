import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchProfileInfo, freshReelMediaUrl } from "@/lib/scrapeCompetitors";

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

  // ?clients=1 — list clients with ids
  if (req.nextUrl.searchParams.get("clients")) {
    const cs = await prisma.client.findMany({ select: { id: true, name: true } });
    return NextResponse.json(cs);
  }

  // ?igreels=clientId — dump the most recent reels with id/permalink/timestamp to debug the Analytics link
  const igreels = req.nextUrl.searchParams.get("igreels");
  if (igreels) {
    const cid = parseInt(igreels);
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
    if (!conn?.accessToken) return NextResponse.json({ error: "not connected" });
    const url = `https://graph.instagram.com/v21.0/me/media?fields=id,media_type,media_product_type,permalink,timestamp&limit=12&access_token=${conn.accessToken}`;
    const r = await fetch(url);
    const d = await r.json();
    return NextResponse.json({
      items: (d.data || []).map((m: any) => ({ id: m.id, type: m.media_type, product: m.media_product_type, permalink: m.permalink ?? null, timestamp: m.timestamp })),
      error: d.error ?? null,
    });
  }

  // ?rawmedia=shortcode — call get_media_data.php and show raw response + parsed video url
  const rawmedia = req.nextUrl.searchParams.get("rawmedia");
  if (rawmedia) {
    const apiKey = process.env.RAPIDAPI_KEY || "";
    const HOST = "instagram-scraper-stable-api.p.rapidapi.com";
    const reelUrl = `https://www.instagram.com/reel/${rawmedia}/`;
    try {
      const qs = new URLSearchParams({ reel_post_code_or_url: reelUrl, type: "reel" });
      const res = await fetch(`https://${HOST}/get_media_data.php?${qs.toString()}`, {
        method: "GET", headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": apiKey },
      });
      const text = await res.text();
      const parsed = await freshReelMediaUrl("", rawmedia);
      return NextResponse.json({ status: res.status, parsedVideoUrl: parsed, raw: text.slice(0, 2000) });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?mediaprobe=shortcode — discover which media-by-id endpoint exists (404 vs 429/200)
  const mediaProbe = req.nextUrl.searchParams.get("mediaprobe");
  if (mediaProbe) {
    const apiKey = process.env.RAPIDAPI_KEY || "";
    const HOST = "instagram-scraper-stable-api.p.rapidapi.com";
    const url = `https://www.instagram.com/reel/${mediaProbe}/`;
    const candidates = [
      "get_media_data.php", "get_ig_media_info.php", "ig_get_post_info.php",
      "get_post_info.php", "get_ig_post.php", "get_media_by_url.php",
      "get_ig_media_data.php", "ig_get_media.php", "get_media_info.php",
    ];
    const out: any = {};
    for (const ep of candidates) {
      try {
        const res = await fetch(`https://${HOST}/${ep}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "x-rapidapi-host": HOST, "x-rapidapi-key": apiKey },
          body: new URLSearchParams({ code_or_id_or_url: url, url, shortcode: mediaProbe }).toString(),
        });
        const t = await res.text();
        out[ep] = { status: res.status, body: t.slice(0, 200) };
      } catch (e) { out[ep] = { error: String(e) }; }
    }
    return NextResponse.json(out);
  }

  // ?profileprobe=handle — fetch one competitor's parsed profile info (debug the enrich)
  const profileProbe = req.nextUrl.searchParams.get("profileprobe");
  if (profileProbe) {
    try {
      const info = await fetchProfileInfo(profileProbe);
      return NextResponse.json({ ok: true, info });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) });
    }
  }

  // ?colcheck=TableName — list a table's columns (verify a migration actually applied)
  const colcheck = req.nextUrl.searchParams.get("colcheck");
  if (colcheck) {
    try {
      const cols = await (prisma as any).$queryRawUnsafe(
        `SELECT column_name::text AS col FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name;`,
        colcheck
      );
      return NextResponse.json({ table: colcheck, columns: cols.map((c: any) => c.col) });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?reeldump=clientId — sample competitor reels to see if a video mediaUrl was stored
  const reeldump = req.nextUrl.searchParams.get("reeldump");
  if (reeldump) {
    const comps = await prisma.competitor.findMany({ where: { clientId: parseInt(reeldump) }, select: { id: true, handle: true } });
    const ids = comps.map((c) => c.id);
    const reels = await (prisma as any).competitorReel.findMany({
      where: { competitorId: { in: ids } }, orderBy: { postedAt: "desc" }, take: 6,
      select: { id: true, shortcode: true, mediaUrl: true, mediaUrlAt: true, thumbnailUrl: true } as any,
    });
    return NextResponse.json(reels.map((r: any) => ({
      id: r.id, shortcode: r.shortcode,
      hasVideo: !!r.mediaUrl, mediaUrlAt: r.mediaUrlAt,
      hasThumb: !!r.thumbnailUrl,
      mediaUrlSample: r.mediaUrl ? r.mediaUrl.slice(0, 80) : null,
    })));
  }

  // ?drafts=clientId — dump script drafts with clientAuthored/status/feedback for debugging
  const draftsDump = req.nextUrl.searchParams.get("drafts");
  if (draftsDump) {
    const cid = parseInt(draftsDump);
    const ds = await prisma.scriptDraft.findMany({
      where: { clientId: cid, isSavedIdea: false },
      orderBy: { generatedAt: "desc" }, take: 30,
      select: { id: true, title: true, status: true, stageId: true, clientAuthored: true, rejectionFeedback: true, conceptId: true, generatedAt: true } as any,
    });
    return NextResponse.json(ds);
  }

  // ?markclient=clientId — backfill clientAuthored=true for this client's self-written drafts
  const markClient = req.nextUrl.searchParams.get("markclient");
  if (markClient) {
    const cid = parseInt(markClient);
    const { count } = await (prisma as any).scriptDraft.updateMany({
      where: { clientId: cid, title: { contains: " script" } },
      data: { clientAuthored: true },
    });
    return NextResponse.json({ ok: true, marked: count });
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
    await (prisma as any).$executeRaw`
      ALTER TABLE "Concept"
      ADD COLUMN IF NOT EXISTS "reelUrls" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "Concept"
      ADD COLUMN IF NOT EXISTS "textOverlay" BOOLEAN NOT NULL DEFAULT false;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "Concept"
      ADD COLUMN IF NOT EXISTS "clientOwned" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "clientQuota" INTEGER,
      ADD COLUMN IF NOT EXISTS "clientIntervalDays" INTEGER,
      ADD COLUMN IF NOT EXISTS "clientAnchor" TEXT;
    `;
    // Competitor scrape state
    await (prisma as any).$executeRaw`
      ALTER TABLE "Competitor"
      ADD COLUMN IF NOT EXISTS "lastScrapedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "lastScrapeError" TEXT;
    `;
    // Competitor reels + time-series snapshots
    await (prisma as any).$executeRaw`
      CREATE TABLE IF NOT EXISTS "CompetitorReel" (
        "id" SERIAL PRIMARY KEY,
        "competitorId" INTEGER NOT NULL REFERENCES "Competitor"("id") ON DELETE CASCADE,
        "shortcode" TEXT NOT NULL,
        "caption" TEXT,
        "thumbnailUrl" TEXT,
        "mediaUrl" TEXT,
        "permalink" TEXT,
        "postedAt" TIMESTAMP,
        "firstSeenAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastScrapedAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `;
    await (prisma as any).$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorReel_competitorId_shortcode_key"
      ON "CompetitorReel"("competitorId", "shortcode");
    `;
    await (prisma as any).$executeRaw`
      CREATE TABLE IF NOT EXISTS "CompetitorReelSnapshot" (
        "id" SERIAL PRIMARY KEY,
        "reelId" INTEGER NOT NULL REFERENCES "CompetitorReel"("id") ON DELETE CASCADE,
        "capturedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "viewCount" INTEGER,
        "likeCount" INTEGER,
        "commentCount" INTEGER
      );
    `;
    await (prisma as any).$executeRaw`
      CREATE INDEX IF NOT EXISTS "CompetitorReelSnapshot_reelId_capturedAt_idx"
      ON "CompetitorReelSnapshot"("reelId", "capturedAt");
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "format" TEXT;
    `;
    await (prisma as any).$executeRaw`
      CREATE TABLE IF NOT EXISTS "ConceptExample" (
        "id" SERIAL PRIMARY KEY,
        "conceptId" INTEGER NOT NULL REFERENCES "Concept"("id") ON DELETE CASCADE,
        "source" TEXT NOT NULL,
        "text" TEXT NOT NULL,
        "hookKey" TEXT,
        "scriptDraftId" INTEGER,
        "reelShortcode" TEXT,
        "views" INTEGER,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `;
    await (prisma as any).$executeRaw`
      CREATE INDEX IF NOT EXISTS "ConceptExample_conceptId_source_idx" ON "ConceptExample"("conceptId", "source");
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ConceptExample" ADD COLUMN IF NOT EXISTS "format" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "TeamMember" ADD COLUMN IF NOT EXISTS "viewOnlyPages" TEXT NOT NULL DEFAULT '';
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "clientAuthored" BOOLEAN NOT NULL DEFAULT false;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "rejectionFeedback" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "mediaUrlAt" TIMESTAMP(3);
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "Competitor"
        ADD COLUMN IF NOT EXISTS "followingCount" INTEGER,
        ADD COLUMN IF NOT EXISTS "postCount" INTEGER,
        ADD COLUMN IF NOT EXISTS "bio" TEXT,
        ADD COLUMN IF NOT EXISTS "profilePicUrl" TEXT,
        ADD COLUMN IF NOT EXISTS "verified" BOOLEAN,
        ADD COLUMN IF NOT EXISTS "lastProfileSyncAt" TIMESTAMP(3);
    `;
    return NextResponse.json({ ok: true, message: "Migration complete." });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
