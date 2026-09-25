import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { fetchProfileInfo, freshReelMediaUrl, scrapeCompetitor } from "@/features/instagram/server/scrapeCompetitors";
import { joinExamples } from "@/features/scripts/server/conceptExamples";
import { isAdminToken } from "@/shared/auth/adminToken";

// GET — debug: show all instagram connections + lead counts
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token");
  if (!isAdminToken(secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?inboxmirror=1 — Instagram Inbox mirror tables (ZernioConversation, ZernioMessage,
  // ZernioWebhookEvent, ZernioSyncState). Idempotent; mirrors the models in prisma/schema.prisma.
  if (req.nextUrl.searchParams.get("inboxmirror")) {
    const out: Record<string, string> = {};
    const stmts: [string, string][] = [
      ["ZernioConversation", `CREATE TABLE IF NOT EXISTS "ZernioConversation" (
        "id" TEXT PRIMARY KEY, "clientId" INTEGER NOT NULL, "accountId" TEXT NOT NULL,
        "platformConversationId" TEXT, "participantId" TEXT, "participantName" TEXT, "participantUsername" TEXT, "participantPicture" TEXT,
        "status" TEXT NOT NULL DEFAULT 'active', "isGroup" BOOLEAN NOT NULL DEFAULT false, "url" TEXT,
        "lastMessageText" TEXT, "lastMessageAt" TIMESTAMP(3), "lastIncomingAt" TIMESTAMP(3), "lastOutgoingAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3),
        "zernioUnreadCount" INTEGER, "igIsFollower" BOOLEAN, "igIsFollowing" BOOLEAN, "igFollowerCount" INTEGER, "igIsVerified" BOOLEAN, "igFetchedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`],
      ["ZernioConversation_clientId_lastMessageAt_idx", `CREATE INDEX IF NOT EXISTS "ZernioConversation_clientId_lastMessageAt_idx" ON "ZernioConversation"("clientId", "lastMessageAt")`],
      ["ZernioConversation_clientId_participantId_idx", `CREATE INDEX IF NOT EXISTS "ZernioConversation_clientId_participantId_idx" ON "ZernioConversation"("clientId", "participantId")`],
      ["ZernioMessage", `CREATE TABLE IF NOT EXISTS "ZernioMessage" (
        "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL, "clientId" INTEGER NOT NULL, "direction" TEXT NOT NULL, "text" TEXT,
        "attachments" TEXT NOT NULL DEFAULT '[]', "senderId" TEXT, "senderName" TEXT, "senderUsername" TEXT, "sentAt" TIMESTAMP(3) NOT NULL,
        "deliveryStatus" TEXT, "isDeleted" BOOLEAN NOT NULL DEFAULT false, "editedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ZernioMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ZernioConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE)`],
      ["ZernioMessage_conversationId_sentAt_idx", `CREATE INDEX IF NOT EXISTS "ZernioMessage_conversationId_sentAt_idx" ON "ZernioMessage"("conversationId", "sentAt")`],
      ["ZernioMessage_clientId_sentAt_idx", `CREATE INDEX IF NOT EXISTS "ZernioMessage_clientId_sentAt_idx" ON "ZernioMessage"("clientId", "sentAt")`],
      ["ZernioWebhookEvent", `CREATE TABLE IF NOT EXISTS "ZernioWebhookEvent" ("id" TEXT PRIMARY KEY, "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`],
      ["ZernioSyncState", `CREATE TABLE IF NOT EXISTS "ZernioSyncState" ("clientId" INTEGER PRIMARY KEY, "cursor" TEXT, "phase" TEXT, "lastFullSyncAt" TIMESTAMP(3), "lastReconcileAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`],
    ];
    for (const [name, sql] of stmts) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ inboxmirror: out });
  }

  // ?reeltest — diagnose why competitor reel videos won't play: call get_media_data with the
  // runtime RapidAPI key and show the raw response.
  // ?txtdiag=1 — find a reel with a stored video but no transcript and show exactly why the
  // Whisper step is failing (size, R2 fetch status, OpenAI response).
  if (req.nextUrl.searchParams.get("txtdiag")) {
    try {
      const reel = await (prisma as any).competitorReel.findFirst({
        where: { AND: [{ cachedVideoUrl: { not: null } }, { transcript: null }, { OR: [{ captureStatus: null }, { captureStatus: { not: "unavailable" } }] }] },
        orderBy: { id: "desc" }, select: { id: true, cachedVideoUrl: true, captureTries: true },
      });
      if (!reel) return NextResponse.json({ note: "no reel with video-but-no-transcript found" });
      const r = await fetch(reel.cachedVideoUrl, { signal: AbortSignal.timeout(40000) });
      const buf = Buffer.from(await r.arrayBuffer());
      const mb = (buf.byteLength / (1024 * 1024)).toFixed(2);
      let whisper: any = "skipped (>24MB)";
      if (buf.byteLength <= 24 * 1024 * 1024 && buf.byteLength > 0) {
        const fd = new FormData();
        fd.append("file", new File([new Uint8Array(buf)], "reel.mp4", { type: "video/mp4" }));
        fd.append("model", "whisper-1");
        const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(90000),
        });
        const t = await wr.text();
        whisper = { status: wr.status, body: t.slice(0, 300) };
      }
      return NextResponse.json({ reelId: reel.id, tries: reel.captureTries, r2Status: r.status, videoMB: mb, whisper });
    } catch (e) {
      return NextResponse.json({ error: "txtdiag crashed: " + (e instanceof Error ? e.message : String(e)) });
    }
  }

  // ?igmediatest=<clientId> — for each of a client's idea reels, show its stored exampleUrl and
  // test resolving media_url via the Graph API (diagnoses the Concept Idea inline player).
  if (req.nextUrl.searchParams.get("igmediatest")) {
    const clientId = parseInt(req.nextUrl.searchParams.get("igmediatest")!);
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId } });
    if (!conn) return NextResponse.json({ error: "no IG connection for client " + clientId });
    const ideas = await (prisma as any).concept.findMany({ where: { clientId, isIdea: true }, select: { id: true, name: true, exampleUrl: true } });
    const out = [];
    for (const it of ideas) {
      const m = String(it.exampleUrl || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/);
      const seg = m ? m[1] : null;
      let graph: any = "no seg";
      if (seg) {
        try {
          const r = await fetch(`https://graph.instagram.com/v21.0/${seg}?fields=media_url,media_type,permalink&access_token=${conn.accessToken}`);
          const gd = await r.json();
          graph = { status: r.status, media_url: gd?.media_url ? "YES" : "NO", media_type: gd?.media_type, error: gd?.error?.message?.slice(0, 120) };
        } catch (e) { graph = "fetch threw: " + String(e); }
      }
      // Is this numeric id actually a stored CompetitorReel row (the client's own feed reels)?
      let compReel: any = null;
      if (seg && /^\d+$/.test(seg)) {
        compReel = await (prisma as any).competitorReel.findUnique({ where: { id: parseInt(seg) }, select: { id: true, shortcode: true, permalink: true, cachedVideoUrl: true } }).catch(() => null);
      }
      out.push({ name: it.name, exampleUrl: it.exampleUrl, seg, numeric: seg ? /^\d+$/.test(seg) : null, graph, compReel });
    }
    return NextResponse.json({ clientId, tokenEnds: conn.accessToken.slice(-6), ideas: out });
  }

  // ?fixexamplelinks=1 — backfill exampleLink on drafts whose example video is a cached
  // competitor reel (comp-examples/<reelId>.mp4) but has no IG link yet.
  if (req.nextUrl.searchParams.get("fixexamplelinks")) {
    const drafts = await (prisma as any).scriptDraft.findMany({
      where: { exampleVideoUrl: { contains: "comp-examples/" }, exampleLink: null },
      select: { id: true, exampleVideoUrl: true },
    });
    let fixed = 0;
    for (const d of drafts) {
      const m = String(d.exampleVideoUrl || "").match(/comp-examples\/(\d+)\.mp4/);
      if (!m) continue;
      const reel = await (prisma as any).competitorReel.findUnique({ where: { id: parseInt(m[1]) }, select: { permalink: true, shortcode: true } });
      const link = reel?.permalink || (reel?.shortcode ? `https://www.instagram.com/reel/${reel.shortcode}/` : null);
      if (link) { await (prisma as any).scriptDraft.update({ where: { id: d.id }, data: { exampleLink: link } }); fixed++; }
    }
    return NextResponse.json({ candidates: drafts.length, fixed });
  }

  // ?remixtest=1 — run a minimal keep-hook remix and show whether the model returns distinct
  // bodies (diagnoses the "same script N times" remix bug).
  if (req.nextUrl.searchParams.get("remixtest")) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ac = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const src = "The reason your biceps don't pop yet is you only do 2-3 sets a week and expect big arms. The one thing you need is to train all three heads: long head, short head, and brachialis, each with a specific angle.";
      const sys = `You remix a proven reel into 3 DISTINCT scripts that make the SAME point different ways.
Keep the hook identical; the "script" field is the BODY ONLY (no hook).
Each of the 3 MUST use a different structural approach: 1) personal story, 2) common mistake→fix, 3) myth-bust. No two bodies may share a full sentence.
Output ONLY a JSON array: [{"title":"..","script":"body only"}]`;
      const msg = await ac.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 4000, temperature: 1,
        system: sys,
        messages: [{ role: "user", content: `Winner:\n"""${src}"""\nGenerate EXACTLY 3 variations, bodies only, genuinely different.` }],
      });
      const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
      const m = raw.match(/\[[\s\S]*\]/);
      let parsed: any[] = [];
      try { parsed = m ? JSON.parse(m[0]) : []; } catch { /* ignore */ }
      const scripts = parsed.map((p: any) => (p.script || "").slice(0, 140));
      const allSame = scripts.length > 1 && scripts.every((s: string) => s === scripts[0]);
      return NextResponse.json({ count: parsed.length, allIdentical: allSame, scripts });
    } catch (e) {
      return NextResponse.json({ error: "remixtest failed: " + (e instanceof Error ? e.message : String(e)) });
    }
  }

  // ?remixtest2=<conceptId> — replicate the FULL production remix prompt (real concept +
  // examples + long Dutch source) to see if the elaborate prompt is what causes copies.
  if (req.nextUrl.searchParams.get("remixtest2")) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const { buildExamplesBlock, splitExamples } = await import("@/features/scripts/server/conceptExamples");
      const ac = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const cid = parseInt(req.nextUrl.searchParams.get("remixtest2")!);
      // param is a clientId; grab that client's most-populated concept (has examples/blueprint).
      const concept = await (prisma as any).concept.findFirst({ where: { clientId: cid, isIdea: false }, orderBy: { id: "desc" } });
      if (!concept) return NextResponse.json({ error: "no concept for client " + cid });
      const clientData = await (prisma as any).client.findUnique({ where: { id: concept.clientId } });
      const source = "De reden waarom jouw biceps nog niet uit je shirt klappen, dat komt omdat jij 2 tot 3 sets per week doet. En dan verwacht dat jij grote biceps gaat krijgen. Het enige wat je nodig hebt om echt die biceps uit je shirt te laten klappen is deze en deze. Als eerste de long head. Die spreek je aan door midden van je bicep achter het lichaam te houden.";
      const sourceHook = source.split("\n").map((l) => l.trim()).find(Boolean) || "";
      const count = 3, keepHook = true;
      const blueprintLines = [concept.hookType && `Hook Type: ${concept.hookType}`, concept.videoType && `Video Type: ${concept.videoType}`, concept.angle && `Angle: ${concept.angle}`, concept.structure && `Structure: ${concept.structure}`, concept.guidelines && `Guidelines:\n${concept.guidelines}`].filter(Boolean).join("\n");
      let examplesSection = await buildExamplesBlock(concept);
      if (!examplesSection && concept.scriptExamples) examplesSection = `\n\nVOICE REFERENCE:\n` + splitExamples(concept.scriptExamples).map((ex: string, i: number) => `Example ${i + 1}:\n${ex.trim()}`).join("\n\n");
      // Long, detailed winner (like a real 440-word script) — this is what triggered the copy bug.
      const longSource = source + " De brachialis train je met een hamercurl, duim omhoog, en die duw je bicep letterlijk omhoog waardoor je arm dikker oogt. De meeste mensen doen alleen maar standaard curls met de dumbbells recht voor zich, en dan drie sets, klaar. Maar zo raak je alleen de buik van de spier en laat je de long head en de brachialis links liggen. Wil je echt groei? Dan train je alle drie de koppen los, elk met de juiste hoek, en verhoog je je volume naar minstens tien sets per week verdeeld over twee sessies. Begin met de long head als je fris bent, dan de short head, en sluit af met de brachialis. Rustig zakken, twee seconden negatief, en knijp bovenin.";
      const sys = `You are a script writer for ${clientData.name}, "${concept.name}" concept.\nBLUEPRINT:\n${blueprintLines}\n${examplesSection}\nLANGUAGE: Write in Dutch.\nREMIX one variation: keep the winner's MESSAGE, write ONE BRAND-NEW body (80-130 words) in the assigned angle. BODY ONLY. The winner is long — your body is short and fresh, never a re-transcription.\nOutput ONLY one JSON object: {"title":"..","script":"body only"}`;
      const FR = ["a personal STORY / confession", "the COMMON MISTAKE then the fix", "a MYTH-BUST / contrarian take"];
      const one = async (frame: string) => {
        const msg = await ac.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1500, temperature: 1, system: sys, messages: [{ role: "user", content: `Winner:\n"""${longSource}"""\nWrite ONE fresh body (80-130 words) using THIS angle: ${frame}. Only the point carries over — no copied sentences.` }] });
        const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
        const mm = raw.match(/\{[\s\S]*\}/);
        try { return mm ? JSON.parse(mm[0]) : null; } catch { return null; }
      };
      const parsed = (await Promise.all(FR.map(one))).filter(Boolean);
      const scripts = parsed.map((p: any) => (p.script || "").slice(0, 130));
      const allSame = scripts.length > 1 && scripts.every((s: string) => s.slice(0, 60) === scripts[0].slice(0, 60));
      return NextResponse.json({ concept: concept.name, srcWords: longSource.split(/\s+/).length, count: parsed.length, allIdentical: allSame, scripts });
    } catch (e) {
      return NextResponse.json({ error: "remixtest failed: " + (e instanceof Error ? e.message : String(e)) });
    }
  }

  // ?editor=1 — video editor tables (EditProject, RenderJob) and Client.subtitleStyle, one
  // statement each like ?reelcols, then a read-back of information_schema so the response
  // proves what exists rather than what was attempted. Safe to re-run.
  if (req.nextUrl.searchParams.get("editor")) {
    const stmts: Array<[string, string]> = [
      ["Client.subtitleStyle", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "subtitleStyle" TEXT`],
      ["EditProject", `CREATE TABLE IF NOT EXISTS "EditProject" (
        "id" SERIAL PRIMARY KEY,
        "draftId" INTEGER NOT NULL UNIQUE REFERENCES "ScriptDraft"("id") ON DELETE CASCADE,
        "clientId" INTEGER NOT NULL,
        "document" TEXT NOT NULL DEFAULT '{}',
        "version" INTEGER NOT NULL DEFAULT 1,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`],
      ["RenderJob", `CREATE TABLE IF NOT EXISTS "RenderJob" (
        "id" SERIAL PRIMARY KEY,
        "projectId" INTEGER NOT NULL REFERENCES "EditProject"("id") ON DELETE CASCADE,
        "documentVersion" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'queued',
        "executor" TEXT NOT NULL,
        "executorRef" TEXT,
        "progress" INTEGER NOT NULL DEFAULT 0,
        "outputKey" TEXT,
        "outputUrl" TEXT,
        "error" TEXT,
        "requestedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "startedAt" TIMESTAMP(3),
        "finishedAt" TIMESTAMP(3)
      )`],
      ["RenderJob_projectId_createdAt_idx", `CREATE INDEX IF NOT EXISTS "RenderJob_projectId_createdAt_idx" ON "RenderJob"("projectId", "createdAt")`],
    ];
    const out: any = {};
    for (const [name, sql] of stmts) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    let columns: any = null;
    try {
      columns = await (prisma as any).$queryRawUnsafe(
        // information_schema exposes these as Postgres type `name`, which the Neon driver cannot
        // deserialize ("Failed to deserialize column of type 'name'"); cast to text.
        `SELECT table_name::text AS table_name, column_name::text AS column_name, data_type::text AS data_type FROM information_schema.columns
         WHERE table_name IN ('EditProject', 'RenderJob') OR (table_name = 'Client' AND column_name = 'subtitleStyle')
         ORDER BY table_name, ordinal_position`
      );
    } catch (e) { columns = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ editor: out, columns });
  }

  // ?reelcols=1 — add the capture-once columns, one statement each (multi-statement raw
  // queries can fail on the Neon adapter), reporting per-column so nothing silently 500s.
  if (req.nextUrl.searchParams.get("reelcols")) {
    const stmts: Array<[string, string]> = [
      ["transcript", `ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "transcript" TEXT`],
      ["transcriptAt", `ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "transcriptAt" TIMESTAMP(3)`],
      ["captureStatus", `ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "captureStatus" TEXT`],
      ["captureTries", `ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "captureTries" INTEGER NOT NULL DEFAULT 0`],
    ];
    const out: any = {};
    for (const [name, sql] of stmts) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ reelcols: out });
  }

  // ?draftexamplecols=1 — add the Kanban example link-back columns, isolated so nothing
  // in the big default block can block them.
  if (req.nextUrl.searchParams.get("draftexamplecols")) {
    const stmts: Array<[string, string]> = [
      ["exampleLink", `ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "exampleLink" TEXT`],
      ["exampleReelId", `ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "exampleReelId" INTEGER`],
      ["exampleThumbnail", `ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "exampleThumbnail" TEXT`],
    ];
    const out: any = {};
    for (const [name, sql] of stmts) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ draftexamplecols: out });
  }

  // ?scrapezeros=<clientId> — force-scrape competitors that have 0 reels (up to 3 per call,
  // newest-added first), to fix coverage gaps. Reports the result per handle.
  if (req.nextUrl.searchParams.get("scrapezeros")) {
    const cid = parseInt(req.nextUrl.searchParams.get("scrapezeros") || "0");
    const comps = await (prisma as any).competitor.findMany({ where: { clientId: cid }, select: { id: true, handle: true } });
    const zeros: { id: number; handle: string }[] = [];
    for (const c of comps) {
      const n = await (prisma as any).competitorReel.count({ where: { competitorId: c.id } });
      if (n === 0) zeros.push({ id: c.id, handle: c.handle });
    }
    const out: any[] = [];
    for (const z of zeros.slice(0, 3)) {
      try { const r = await scrapeCompetitor(z.id, { full: false }); out.push({ handle: z.handle, ...r }); }
      catch (e) { out.push({ handle: z.handle, ok: false, error: String(e).slice(0, 200) }); }
    }
    return NextResponse.json({ zerosFound: zeros.length, scraped: out });
  }

  // ?capturetest=<reelId> — trace each step of capturing one reel's video.
  if (req.nextUrl.searchParams.get("capturetest")) {
    const rid = parseInt(req.nextUrl.searchParams.get("capturetest") || "0");
    const reel = await (prisma as any).competitorReel.findUnique({ where: { id: rid }, include: { competitor: { select: { handle: true } } } });
    if (!reel) return NextResponse.json({ error: "reel not found" });
    const { cacheImageToR2 } = await import("@/shared/media/r2");
    const out: any = { handle: reel.competitor?.handle, shortcode: reel.shortcode, hadCached: reel.cachedVideoUrl || null, listMediaUrl: reel.mediaUrl ? reel.mediaUrl.slice(0, 60) : null };
    let fresh: string | null = null;
    try { fresh = await freshReelMediaUrl(reel.competitor?.handle || "", reel.shortcode); } catch (e) { out.freshError = String(e).slice(0, 120); }
    out.freshResolved = !!fresh;
    out.freshSample = fresh ? fresh.slice(0, 80) : null;
    if (fresh) {
      try {
        const r2 = await cacheImageToR2(fresh, `comp-videos/${rid}.mp4`);
        out.r2Url = r2;
        if (r2) await (prisma as any).competitorReel.update({ where: { id: rid }, data: { cachedVideoUrl: r2, captureStatus: "pending" } }).catch(() => {});
      } catch (e) { out.downloadError = String(e).slice(0, 160); }
    }
    return NextResponse.json(out);
  }

  // ?scrapeclient=<clientId> — capture the newest uncaptured reels for each of a client's
  // competitors, sequentially (paced to dodge the vendor rate limit). Fixes recent "Saving".
  if (req.nextUrl.searchParams.get("scrapeclient")) {
    const cid = parseInt(req.nextUrl.searchParams.get("scrapeclient") || "0");
    const per = Math.min(parseInt(req.nextUrl.searchParams.get("per") || "8") || 8, 15);
    const comps = await (prisma as any).competitor.findMany({ where: { clientId: cid }, select: { id: true, handle: true } });
    const { cacheImageToR2 } = await import("@/shared/media/r2");
    const out: any[] = [];
    for (const c of comps) {
      const reels = await (prisma as any).competitorReel.findMany({ where: { competitorId: c.id, cachedVideoUrl: null }, orderBy: { postedAt: "desc" }, take: per, select: { id: true, shortcode: true } });
      let saved = 0;
      for (const r of reels) {
        try {
          const fresh = await freshReelMediaUrl(c.handle, r.shortcode);
          if (fresh) {
            const url = await cacheImageToR2(fresh, `comp-videos/${r.id}.mp4`);
            if (url) { await (prisma as any).competitorReel.update({ where: { id: r.id }, data: { cachedVideoUrl: url, captureStatus: "pending" } }); saved++; }
          }
        } catch { /* skip */ }
        await new Promise((res) => setTimeout(res, 250)); // gentle pacing
      }
      out.push({ handle: c.handle, targeted: reels.length, saved });
    }
    return NextResponse.json({ results: out });
  }

  // ?reelstats=<clientId> — per-competitor reel counts + date range, to diagnose scrape coverage.
  if (req.nextUrl.searchParams.get("reelstats")) {
    const cid = parseInt(req.nextUrl.searchParams.get("reelstats") || "0");
    const comps = await (prisma as any).competitor.findMany({ where: { clientId: cid }, select: { id: true, handle: true, lastScrapedAt: true, lastScrapeError: true } });
    const rows: any[] = [];
    for (const c of comps) {
      const count = await (prisma as any).competitorReel.count({ where: { competitorId: c.id } });
      const newest = await (prisma as any).competitorReel.findFirst({ where: { competitorId: c.id }, orderBy: { postedAt: "desc" }, select: { postedAt: true } });
      const oldest = await (prisma as any).competitorReel.findFirst({ where: { competitorId: c.id }, orderBy: { postedAt: "asc" }, select: { postedAt: true } });
      rows.push({ handle: c.handle, reels: count, newest: newest?.postedAt || null, oldest: oldest?.postedAt || null, lastScrapedAt: c.lastScrapedAt || null, err: c.lastScrapeError || null });
    }
    rows.sort((a, b) => b.reels - a.reels);
    return NextResponse.json({ total: rows.reduce((s, r) => s + r.reels, 0), competitors: rows.length, rows });
  }

  if (req.nextUrl.searchParams.get("platformcols")) {
    const out: any = {};
    for (const [name, sql] of [
      ["Concept", `ALTER TABLE "Concept" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["ScriptDraft", `ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["WorkflowStage", `ALTER TABLE "WorkflowStage" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["Creator", `ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ platformcols: out });
  }

  // ?ttprobe=<handle> — inspect the raw apibox TikTok API responses so we can verify field
  // mapping after subscribing. Returns the raw info JSON + first raw post item.
  if (req.nextUrl.searchParams.get("ttprobe")) {
    const handle = String(req.nextUrl.searchParams.get("ttprobe")).replace(/^@/, "").trim();
    const HOST = "tiktok-api23.p.rapidapi.com";
    const h = { "x-rapidapi-host": HOST, "x-rapidapi-key": process.env.RAPIDAPI_KEY || "" };
    const out: any = { handle };
    try {
      const infoRes = await fetch(`https://${HOST}/api/user/info?uniqueId=${encodeURIComponent(handle)}`, { headers: h });
      out.infoStatus = infoRes.status;
      const info = await infoRes.json().catch(() => null);
      out.infoKeys = info ? Object.keys(info) : null;
      const user = info?.userInfo?.user ?? info?.data?.user ?? info?.user ?? null;
      out.secUid = user?.secUid ?? null;
      out.userKeys = user ? Object.keys(user) : null;
      out.stats = info?.userInfo?.stats ?? info?.stats ?? null;
      if (out.secUid) {
        const postsRes = await fetch(`https://${HOST}/api/user/posts?secUid=${encodeURIComponent(out.secUid)}&count=5&cursor=0`, { headers: h });
        out.postsStatus = postsRes.status;
        const posts = await postsRes.json().catch(() => null);
        out.postsKeys = posts ? Object.keys(posts) : null;
        const items = posts?.data?.itemList ?? posts?.itemList ?? posts?.data?.videos ?? [];
        out.postCount = items.length;
        out.firstItem = items[0] ?? null;
      }
    } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
    return NextResponse.json(out);
  }

  // Daily snapshot table for official TikTok stats (follower/likes/views growth charts).
  if (req.nextUrl.searchParams.get("ttsnapshots")) {
    const out: any = {};
    for (const [name, sql] of [
      ["table", `CREATE TABLE IF NOT EXISTS "TikTokDailySnapshot" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "day" TEXT NOT NULL, "followerCount" INTEGER, "followingCount" INTEGER, "likesCount" INTEGER, "videoCount" INTEGER, "totalViews" INTEGER, "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`],
      ["unique", `CREATE UNIQUE INDEX IF NOT EXISTS "TikTokDailySnapshot_clientId_day_key" ON "TikTokDailySnapshot"("clientId","day")`],
      ["index", `CREATE INDEX IF NOT EXISTS "TikTokDailySnapshot_clientId_day_idx" ON "TikTokDailySnapshot"("clientId","day")`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ ttsnapshots: out });
  }

  // Official TikTok OAuth (Login Kit) token columns on Client.
  if (req.nextUrl.searchParams.get("ttoauth")) {
    const out: any = {};
    for (const [name, sql] of [
      ["tiktokAccessToken", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokAccessToken" TEXT`],
      ["tiktokRefreshToken", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokRefreshToken" TEXT`],
      ["tiktokTokenExpiresAt", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokTokenExpiresAt" TIMESTAMP(3)`],
      ["tiktokOpenId", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokOpenId" TEXT`],
      ["tiktokScope", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokScope" TEXT`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ ttoauth: out });
  }

  // Diagnostic: what does Zernio return for accounts? Shows every account (platform + username)
  // across a few query variants so we can see if/where the TikTok account is.
  if (req.nextUrl.searchParams.get("zerniottdiag")) {
    const KEY = process.env.ZERNIO_API_KEY || "";
    const PID = process.env.ZERNIO_PROFILE_ID || "";
    const h = { Authorization: `Bearer ${KEY}`, Accept: "application/json" };
    const variants: [string, string][] = [
      ["all_no_params", "https://zernio.com/api/v1/accounts"],
      ["default_profile", `https://zernio.com/api/v1/accounts?profileId=${PID}`],
      ["default_profile_tiktok", `https://zernio.com/api/v1/accounts?profileId=${PID}&platform=tiktok`],
    ];
    const out: any = { keySet: !!KEY, profileIdSet: !!PID, results: {} };
    for (const [name, url] of variants) {
      try {
        const r = await fetch(url, { headers: h });
        const j: any = await r.json().catch(() => null);
        const accts: any[] = j?.accounts ?? j?.data ?? [];
        out.results[name] = {
          status: r.status,
          count: Array.isArray(accts) ? accts.length : "n/a",
          accounts: (Array.isArray(accts) ? accts : []).map((a) => ({ platform: a.platform, username: a.username ?? a.displayName ?? a.name, id: a._id ?? a.id, profileId: a.profileId })),
          error: j?.error ?? j?.message,
        };
      } catch (e) { out.results[name] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    return NextResponse.json(out);
  }

  // Diagnostic: TikTok competitor scrape freshness (is the every-4h cron actually running?).
  if (req.nextUrl.searchParams.get("ttcronhealth")) {
    const now = Date.now();
    const comps: any[] = await (prisma as any).competitor.findMany({
      where: { platform: "tiktok" }, select: { handle: true, lastScrapedAt: true, lastScrapeError: true },
    }).catch(() => []);
    const withTs = comps.filter((c) => c.lastScrapedAt).map((c) => new Date(c.lastScrapedAt).getTime());
    const staleBefore = now - 20 * 3600 * 1000;
    const errors = comps.filter((c) => c.lastScrapeError).slice(0, 8).map((c) => ({ handle: c.handle, err: String(c.lastScrapeError).slice(0, 80) }));
    return NextResponse.json({
      totalTikTokCompetitors: comps.length,
      neverScraped: comps.filter((c) => !c.lastScrapedAt).length,
      staleOver20h: comps.filter((c) => !c.lastScrapedAt || new Date(c.lastScrapedAt).getTime() < staleBefore).length,
      mostRecentScrapeAgoHours: withTs.length ? +(((now - Math.max(...withTs)) / 3600000).toFixed(1)) : null,
      oldestScrapeAgoHours: withTs.length ? +(((now - Math.min(...withTs)) / 3600000).toFixed(1)) : null,
      recentErrors: errors,
    });
  }

  // Diagnostic: Zernio daily-metrics (attribution=received) for the first TikTok-linked client.
  if (req.nextUrl.searchParams.get("zerniodaily")) {
    const KEY = process.env.ZERNIO_API_KEY || "";
    const c = await (prisma as any).client.findFirst({ where: { tiktokZernioAccountId: { not: null } }, select: { id: true, name: true, tiktokZernioAccountId: true, tiktokZernioProfileId: true } });
    if (!c) return NextResponse.json({ note: "no tiktok-linked client" });
    const out: any = { client: c.name, accountId: c.tiktokZernioAccountId };
    for (const attribution of ["received", "publish"]) {
      const u = new URL("https://zernio.com/api/v1/analytics/daily-metrics");
      u.searchParams.set("platform", "tiktok");
      u.searchParams.set("accountId", c.tiktokZernioAccountId);
      if (c.tiktokZernioProfileId) u.searchParams.set("profileId", c.tiktokZernioProfileId);
      u.searchParams.set("attribution", attribution);
      u.searchParams.set("fromDate", new Date(Date.now() - 8 * 86400_000).toISOString());
      u.searchParams.set("toDate", new Date().toISOString());
      try {
        const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
        const j: any = await r.json().catch(() => null);
        const rows: any[] = j?.dailyData ?? [];
        out[attribution] = {
          status: r.status,
          error: j?.error ?? j?.message,
          days: rows.length,
          sumViews: rows.reduce((s, d) => s + (d?.metrics?.views || 0), 0),
          sample: rows.map((d) => ({ date: String(d.date).slice(0, 10), views: d?.metrics?.views })),
        };
      } catch (e) { out[attribution] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    return NextResponse.json(out);
  }


  // TikTok Instructions engine cache table.
  if (req.nextUrl.searchParams.get("ttinstructions")) {
    const out: any = {};
    try {
      await (prisma as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TikTokInstructions" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "data" TEXT NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await (prisma as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TikTokInstructions_clientId_key" ON "TikTokInstructions"("clientId")`);
      out.table = "ok";
    } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
    return NextResponse.json({ ttinstructions: out });
  }

  // TikTok video → concept mapping table.
  if (req.nextUrl.searchParams.get("ttvideoconcept")) {
    const out: any = {};
    try {
      await (prisma as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TikTokVideoConcept" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "videoId" TEXT NOT NULL, "conceptId" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      await (prisma as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TikTokVideoConcept_clientId_videoId_key" ON "TikTokVideoConcept"("clientId", "videoId")`);
      await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TikTokVideoConcept_clientId_conceptId_idx" ON "TikTokVideoConcept"("clientId", "conceptId")`);
      out.table = "ok";
    } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
    return NextResponse.json({ ttvideoconcept: out });
  }

  // TikTok via Zernio — link the client's TikTok account (connected in Zernio) for analytics.
  if (req.nextUrl.searchParams.get("ttzernio")) {
    const out: any = {};
    for (const [name, sql] of [
      ["tiktokZernioAccountId", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokZernioAccountId" TEXT`],
      ["tiktokZernioUsername", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokZernioUsername" TEXT`],
      ["tiktokZernioProfileId", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokZernioProfileId" TEXT`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ ttzernio: out });
  }

  // TikTok Competitor Finder: add platform to candidates + widen the unique key to include platform.
  if (req.nextUrl.searchParams.get("ttfinder")) {
    const out: any = {};
    for (const [name, sql] of [
      ["candidate.platform", `ALTER TABLE "CompetitorCandidate" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["drop old unique", `DROP INDEX IF EXISTS "CompetitorCandidate_clientId_handle_key"`],
      ["new unique", `CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorCandidate_clientId_platform_handle_key" ON "CompetitorCandidate"("clientId","platform","handle")`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ ttfinder: out });
  }

  if (req.nextUrl.searchParams.get("tiktokstudio")) {
    const out: any = {};
    for (const [name, sql] of [
      ["Competitor.platform", `ALTER TABLE "Competitor" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["CompetitorReel.platform", `ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'instagram'`],
      ["Client.tiktokHandle", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokHandle" TEXT`],
      ["Client.tiktokProfileData", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokProfileData" TEXT`],
      ["Client.tiktokProfileAt", `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokProfileAt" TIMESTAMP(3)`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ tiktokstudio: out });
  }

  if (req.nextUrl.searchParams.get("igcol")) {
    const out: any = {};
    try { await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "instagramEnabled" BOOLEAN NOT NULL DEFAULT true`); out.instagramEnabled = "ok"; }
    catch (e) { out.instagramEnabled = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ igcol: out });
  }

  if (req.nextUrl.searchParams.get("tiktokcol")) {
    const out: any = {};
    try { await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "tiktokEnabled" BOOLEAN NOT NULL DEFAULT false`); out.tiktokEnabled = "ok"; }
    catch (e) { out.tiktokEnabled = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ tiktokcol: out });
  }

  // ?clipcol=1 — Clipping: which long-form draft a short clip was cut from. Shipped one deploy
  // ahead of the schema field and the code that reads it. Idempotent.
  if (req.nextUrl.searchParams.get("clipcol")) {
    const out: any = {};
    for (const [name, sql] of [
      ["ScriptDraft.clipOfDraftId", `ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "clipOfDraftId" INTEGER`],
      ["ScriptDraft_clipOfDraftId_idx", `CREATE INDEX IF NOT EXISTS "ScriptDraft_clipOfDraftId_idx" ON "ScriptDraft"("clipOfDraftId")`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    return NextResponse.json({ clipcol: out });
  }

  // ?clipjobs=1 — Clipping as an agent workflow: a job per long-form video that reached Publish,
  // and every candidate clip an agent (or a person) submitted for it, versioned per clip chain,
  // with the verdict and the final edges. Shipped one deploy ahead of the schema models and the
  // code that reads them. Idempotent.
  if (req.nextUrl.searchParams.get("clipjobs")) {
    const out: any = {};
    for (const [name, sql] of [
      ["ClipJob", `CREATE TABLE IF NOT EXISTS "ClipJob" (
        "id" SERIAL PRIMARY KEY,
        "sourceDraftId" INTEGER NOT NULL UNIQUE,
        "clientId" INTEGER NOT NULL,
        "sourceUrl" TEXT,
        "status" TEXT NOT NULL DEFAULT 'open',
        "trigger" TEXT NOT NULL DEFAULT 'stage',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedAt" TIMESTAMP(3))`],
      ["ClipJob_clientId_status_idx", `CREATE INDEX IF NOT EXISTS "ClipJob_clientId_status_idx" ON "ClipJob"("clientId","status")`],
      ["ClipCandidate", `CREATE TABLE IF NOT EXISTS "ClipCandidate" (
        "id" SERIAL PRIMARY KEY,
        "jobId" INTEGER NOT NULL,
        "chainId" INTEGER,
        "version" INTEGER NOT NULL DEFAULT 1,
        "origin" TEXT NOT NULL DEFAULT 'agent',
        "agentId" TEXT NOT NULL,
        "agentVersion" TEXT NOT NULL DEFAULT '',
        "targetPlatform" TEXT NOT NULL DEFAULT 'instagram',
        "conceptId" INTEGER,
        "title" TEXT NOT NULL,
        "reasoning" TEXT NOT NULL DEFAULT '',
        "confidence" DOUBLE PRECISION,
        "document" TEXT NOT NULL,
        "inMs" INTEGER NOT NULL,
        "outMs" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "declineReasons" TEXT NOT NULL DEFAULT '[]',
        "declineNote" TEXT,
        "reviewedBy" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "finalInMs" INTEGER,
        "finalOutMs" INTEGER,
        "finalDocument" TEXT,
        "draftId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`],
      ["ClipCandidate_jobId_idx", `CREATE INDEX IF NOT EXISTS "ClipCandidate_jobId_idx" ON "ClipCandidate"("jobId")`],
      ["ClipCandidate_chainId_version_idx", `CREATE INDEX IF NOT EXISTS "ClipCandidate_chainId_version_idx" ON "ClipCandidate"("chainId","version")`],
      ["ClipCandidate_agent_idx", `CREATE INDEX IF NOT EXISTS "ClipCandidate_agent_idx" ON "ClipCandidate"("agentId","agentVersion")`],
      ["ClipCandidate_status_idx", `CREATE INDEX IF NOT EXISTS "ClipCandidate_status_idx" ON "ClipCandidate"("status")`],
    ] as [string, string][]) {
      try { await (prisma as any).$executeRawUnsafe(sql); out[name] = "ok"; }
      catch (e) { out[name] = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    }
    const cols = await (prisma as any).$queryRawUnsafe(`SELECT table_name, count(*)::int AS columns FROM information_schema.columns WHERE table_name IN ('ClipJob','ClipCandidate') GROUP BY table_name`);
    return NextResponse.json({ clipjobs: out, tables: cols });
  }

  // ?youtubecol=1 — per-client YouTube toggle (YouTube Kanban + Clipping). Idempotent.
  if (req.nextUrl.searchParams.get("youtubecol")) {
    const out: any = {};
    try { await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "youtubeEnabled" BOOLEAN NOT NULL DEFAULT false`); out.youtubeEnabled = "ok"; }
    catch (e) { out.youtubeEnabled = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ youtubecol: out });
  }

  if (req.nextUrl.searchParams.get("workspaces")) {
    const out: any = {};
    try {
      await (prisma as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Workspace" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "color" TEXT NOT NULL DEFAULT '#3d4aa3', "order" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
      out.table = "ok";
      await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "workspaceId" INTEGER`);
      out.column = "ok";
      // Seed a default "OPT" workspace and put every existing client in it.
      await (prisma as any).$executeRawUnsafe(`INSERT INTO "Workspace" ("name","color","order","createdAt") SELECT 'OPT','#3d4aa3',0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "Workspace")`);
      await (prisma as any).$executeRawUnsafe(`UPDATE "Client" SET "workspaceId" = (SELECT id FROM "Workspace" ORDER BY id ASC LIMIT 1) WHERE "workspaceId" IS NULL`);
      out.seeded = "ok";
      const ws = await (prisma as any).workspace.findMany({ select: { id: true, name: true, _count: { select: { clients: true } } } });
      out.workspaces = ws;
    } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
    return NextResponse.json({ workspaces: out });
  }

  if (req.nextUrl.searchParams.get("competitortags")) {
    const out: any = {};
    try { await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Competitor" ADD COLUMN IF NOT EXISTS "tags" TEXT`); out.tags = "ok"; }
    catch (e) { out.tags = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ competitortags: out });
  }

  if (req.nextUrl.searchParams.get("boardpending")) {
    const out: any = {};
    try { await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "pendingVideos" TEXT NOT NULL DEFAULT '[]'`); out.pendingVideos = "ok"; }
    catch (e) { out.pendingVideos = "ERR: " + (e instanceof Error ? e.message : String(e)); }
    return NextResponse.json({ boardpending: out });
  }

  // ?fixboards=1 — undo the bad server-appended video tiles (their url is a RELATIVE
  // "/api/vid…", client-added ones are absolute). Removing them restores the board.
  if (req.nextUrl.searchParams.get("fixboards")) {
    const boards = await (prisma as any).board.findMany();
    const report: any[] = [];
    for (const b of boards) {
      let snap: any = {};
      try { snap = b.snapshot ? JSON.parse(b.snapshot) : {}; } catch { report.push({ clientId: b.clientId, error: "unparseable" }); continue; }
      const els: any[] = Array.isArray(snap.elements) ? snap.elements : [];
      const before = els.length;
      const kept = els.filter((e) => !(e && typeof e.customData?.video?.url === "string" && e.customData.video.url.startsWith("/api/vid")));
      if (kept.length !== before) {
        snap.elements = kept;
        await (prisma as any).board.update({ where: { clientId: b.clientId }, data: { snapshot: JSON.stringify(snap) } });
        report.push({ clientId: b.clientId, removed: before - kept.length });
      }
    }
    return NextResponse.json({ fixboards: report });
  }

  // ?reelhandle=imredelouw — test EVERY stored reel for one competitor through the real
  // freshReelMediaUrl and report which return null (pinpoints per-reel failures).
  if (req.nextUrl.searchParams.get("reelhandle")) {
    try {
      const { freshReelMediaUrl } = await import("@/features/instagram/server/scrapeCompetitors");
      const handle = req.nextUrl.searchParams.get("reelhandle")!.replace(/^@/, "");
      const comp = await (prisma as any).competitor.findFirst({ where: { handle: { equals: handle, mode: "insensitive" } }, select: { id: true, handle: true } });
      if (!comp) return NextResponse.json({ error: "competitor not found", handle });
      const reels = await (prisma as any).competitorReel.findMany({ where: { competitorId: comp.id }, orderBy: { id: "desc" }, take: 12, select: { id: true, shortcode: true, permalink: true, mediaUrl: true } });
      const results = [];
      for (const r of reels) {
        const url = await freshReelMediaUrl(comp.handle, r.shortcode).catch((e) => "THREW:" + String(e));
        results.push({ id: r.id, shortcode: r.shortcode, hasStored: !!r.mediaUrl, result: typeof url === "string" && url.startsWith("http") ? "OK" : (url || "NULL") });
      }
      return NextResponse.json({ handle: comp.handle, count: reels.length, results });
    } catch (e) {
      return NextResponse.json({ error: "crashed: " + (e instanceof Error ? e.message : String(e)) });
    }
  }

  if (req.nextUrl.searchParams.get("reeltest")) {
    try {
      const { freshReelMediaUrl } = await import("@/features/instagram/server/scrapeCompetitors");
      const reel = await (prisma as any).competitorReel.findFirst({ orderBy: { id: "desc" }, select: { id: true, shortcode: true, competitorId: true } });
      if (!reel) return NextResponse.json({ error: "no competitor reels in DB" });
      const comp = await (prisma as any).competitor.findUnique({ where: { id: reel.competitorId }, select: { handle: true } });
      const key = process.env.RAPIDAPI_KEY || "";
      const HOST = "instagram-scraper-stable-api.p.rapidapi.com";
      // What the app actually computes for this reel:
      const appResult = await freshReelMediaUrl(comp?.handle || "", reel.shortcode).catch((e) => "THREW: " + String(e));
      // Direct type=post and type=reel calls with the runtime key, for comparison:
      const direct = async (type: string) => {
        try {
          const qs = new URLSearchParams({ reel_post_code_or_url: `https://www.instagram.com/reel/${reel.shortcode}/`, type });
          const r = await fetch(`https://${HOST}/get_media_data.php?${qs}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": key } });
          const t = await r.text();
          const m = t.match(/"video_versions":\s*\[\s*\{[^}]*?"url":\s*"([^"]+?\.mp4[^"]*)"/) || t.match(/(https:[^"\\ ]+?\.mp4)/);
          return { status: r.status, mp4: m ? "YES" : "NO", snippet: m ? m[1].slice(0, 70) : t.slice(0, 150) };
        } catch (e) { return { status: 0, mp4: "ERR", snippet: String(e) }; }
      };
      return NextResponse.json({
        storedShortcode: reel.shortcode, reelId: reel.id, handle: comp?.handle,
        keyLen: key.length, keyEnds: key.slice(-6),
        appResult: typeof appResult === "string" ? appResult.slice(0, 120) : appResult,
        directPost: await direct("post"), directReel: await direct("reel"),
      });
    } catch (e) {
      return NextResponse.json({ error: "probe crashed: " + (e instanceof Error ? e.message : String(e)) });
    }
  }

  // ?wacheck — show which Twilio/WhatsApp env vars are present (masked) + their shape.
  if (req.nextUrl.searchParams.get("wacheck")) {
    const mask = (v?: string) => (v ? `set (len ${v.length}, ends …${v.slice(-4)})` : "MISSING");
    return NextResponse.json({
      TWILIO_ACCOUNT_SID: mask(process.env.TWILIO_ACCOUNT_SID),
      TWILIO_AUTH_TOKEN: mask(process.env.TWILIO_AUTH_TOKEN),
      TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || "MISSING",
      OWNER_WHATSAPP_TO: process.env.OWNER_WHATSAPP_TO || "MISSING",
      TWILIO_WHATSAPP_CONTENT_SID: process.env.TWILIO_WHATSAPP_CONTENT_SID || "MISSING (plain Body / sandbox mode)",
    });
  }

  // ?watest — actually send a test WhatsApp and return Twilio's raw response (status,
  // error_code, message) so we can see exactly why delivery fails.
  if (req.nextUrl.searchParams.get("watest")) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    let from = process.env.TWILIO_WHATSAPP_FROM;
    let to = process.env.OWNER_WHATSAPP_TO;
    if (!sid || !tok || !from || !to) {
      return NextResponse.json({ ok: false, reason: "missing env", have: { sid: !!sid, tok: !!tok, from: from || null, to: to || null } });
    }
    if (!from.startsWith("whatsapp:")) from = `whatsapp:${from}`;
    if (!to.startsWith("whatsapp:")) to = `whatsapp:${to}`;
    const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID;
    try {
      const params = new URLSearchParams({ From: from, To: to });
      if (contentSid) {
        params.set("ContentSid", contentSid);
        params.set("ContentVariables", JSON.stringify({ "1": "✅ ORDO test — WhatsApp alerts work." }));
      } else {
        params.set("Body", "✅ ORDO test message — if you see this, WhatsApp alerts work.");
      }
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const j = await r.json().catch(() => ({}));
      return NextResponse.json({ mode: contentSid ? "template" : "body", httpStatus: r.status, sid: j.sid || null, status: j.status || null, error_code: j.code || j.error_code || null, error_message: j.message || j.error_message || null, from, to });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) });
    }
  }

  // ?rapidcheck — is the competitor scraper (RapidAPI) configured + working?
  if (req.nextUrl.searchParams.get("rapidcheck")) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return NextResponse.json({ RAPIDAPI_KEY: "MISSING", working: false, note: "Competitors page can't scrape without this key." });
    try {
      const host = "instagram-scraper-stable-api.p.rapidapi.com";
      const r = await fetch(`https://${host}/get_ig_user_reels.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "x-rapidapi-host": host, "x-rapidapi-key": key },
        body: new URLSearchParams({ username_or_url: "chrisbumstead", amount: "1" }).toString(),
      });
      const text = (await r.text()).slice(0, 200);
      return NextResponse.json({ RAPIDAPI_KEY: `set (len ${key.length})`, testHttpStatus: r.status, working: r.status === 200, sample: text });
    } catch (e) {
      return NextResponse.json({ RAPIDAPI_KEY: "set", working: false, error: String(e) });
    }
  }

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

  // ?team=1 — dump all team members (name, clientId, isClientAccount) + clients
  if (req.nextUrl.searchParams.get("team")) {
    const members = await prisma.teamMember.findMany({ orderBy: { id: "asc" } });
    const cls = await prisma.client.findMany({ select: { id: true, name: true } });
    return NextResponse.json({
      clients: cls,
      members: members.map((m: any) => ({ id: m.id, name: m.name, email: m.email, clientId: m.clientId, isClientAccount: m.isClientAccount, pageAccess: m.pageAccess, viewOnlyPages: m.viewOnlyPages })),
    });
  }

  // ?conceptlist=clientId — list concepts (flags) + the client's saved dayTemplate
  const conceptList = req.nextUrl.searchParams.get("conceptlist");
  if (conceptList) {
    const where = conceptList === "1" ? {} : { clientId: parseInt(conceptList) };
    const cs = await prisma.concept.findMany({ where, orderBy: { id: "desc" }, take: 40 });
    const client = conceptList !== "1" ? await prisma.client.findUnique({ where: { id: parseInt(conceptList) }, select: { dayTemplate: true } as any }) : null;
    return NextResponse.json({
      concepts: cs.map((c: any) => ({ id: c.id, name: c.name, conceptType: c.conceptType, clientId: c.clientId, isIdea: c.isIdea, clientOwned: c.clientOwned })),
      dayTemplate: (client as any)?.dayTemplate ?? null,
    });
  }

  // ?runextract=conceptId — run the real on-screen-text extraction and WRITE the examples
  const runExtract = req.nextUrl.searchParams.get("runextract");
  if (runExtract) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const conceptId = parseInt(runExtract);
    const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
    if (!concept?.clientId) return NextResponse.json({ error: "no concept/client" });
    let reelUrls: string[] = [];
    try { reelUrls = JSON.parse((concept as any).reelUrls || "[]"); } catch {}
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: concept.clientId } });
    const tok = (u: string) => ((u || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i)?.[1] || u || "").trim();
    const wanted = new Set(reelUrls.map(tok));
    const matched: Record<string, any> = {};
    let url: string | null = `https://graph.instagram.com/v21.0/me/media?fields=id,permalink,thumbnail_url,media_url&limit=50&access_token=${conn!.accessToken}`;
    let pages = 0;
    while (url && pages < 12 && Object.keys(matched).length < wanted.size) {
      pages++;
      const data: any = await (await fetch(url)).json();
      if (!data?.data) break;
      for (const m of data.data) { const t = tok(m.permalink || ""); if (wanted.has(t)) matched[t] = m; }
      url = data.paging?.next || null;
    }
    async function vision(imageUrl: string) {
      try {
        const r = await fetch(imageUrl); if (!r.ok) return "";
        const buf = Buffer.from(await r.arrayBuffer());
        const m = await anthropic.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 500,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } },
            { type: "text", text: "Read and output ONLY the exact on-screen text shown, word for word, preserving line breaks. If no readable text overlay, output nothing." },
          ] }],
        });
        return (m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")).trim();
      } catch { return ""; }
    }
    const texts = await Promise.all(reelUrls.map(async (u) => {
      const m = matched[tok(u)]; if (!m) return "";
      return vision(m.thumbnail_url || m.media_url);
    }));
    const seen = new Set<string>(); const added: string[] = [];
    for (const t of texts) {
      if (!t || t.length < 8 || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase()); added.push(t);
    }
    if (added.length) await prisma.concept.update({ where: { id: conceptId }, data: { scriptExamples: joinExamples(added) } });
    return NextResponse.json({ ok: true, added: added.length, examples: added });
  }

  // ?visiondbg=conceptId — run vision on each matched reel's cover, return the text it sees
  const visionDbg = req.nextUrl.searchParams.get("visiondbg");
  if (visionDbg) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const conceptId = parseInt(visionDbg);
    const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
    if (!concept?.clientId) return NextResponse.json({ error: "no concept/client" });
    let reelUrls: string[] = [];
    try { reelUrls = JSON.parse((concept as any).reelUrls || "[]"); } catch {}
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: concept.clientId } });
    const tok = (u: string) => ((u || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i)?.[1] || u || "").trim();
    const wanted = new Set(reelUrls.map(tok));
    const matched: Record<string, any> = {};
    let url: string | null = `https://graph.instagram.com/v21.0/me/media?fields=id,permalink,thumbnail_url,media_url&limit=50&access_token=${conn!.accessToken}`;
    let pages = 0;
    while (url && pages < 12 && Object.keys(matched).length < wanted.size) {
      pages++;
      const data: any = await (await fetch(url)).json();
      if (!data?.data) break;
      for (const m of data.data) { const t = tok(m.permalink || ""); if (wanted.has(t)) matched[t] = m; }
      url = data.paging?.next || null;
    }
    async function vision(imageUrl: string) {
      try {
        const r = await fetch(imageUrl); if (!r.ok) return `fetch ${r.status}`;
        const buf = Buffer.from(await r.arrayBuffer());
        const m = await anthropic.messages.create({
          model: "claude-sonnet-4-6", max_tokens: 500,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } },
            { type: "text", text: "Read and output ONLY the exact on-screen text shown, word for word. If no readable text overlay, output the single word NONE." },
          ] }],
        });
        return (m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")).trim();
      } catch (e) { return `err ${String(e).slice(0, 80)}`; }
    }
    const results = await Promise.all(Object.entries(matched).map(async ([t, m]) => ({
      token: t, hasThumb: !!m.thumbnail_url, visionText: await vision(m.thumbnail_url || m.media_url),
    })));
    return NextResponse.json(results);
  }

  // ?extractdbg=conceptId — diagnose why extract-examples pulls nothing for a concept
  const extractDbg = req.nextUrl.searchParams.get("extractdbg");
  if (extractDbg) {
    const conceptId = parseInt(extractDbg);
    const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
    if (!concept) return NextResponse.json({ error: "concept not found" });
    let reelUrls: string[] = [];
    try { reelUrls = JSON.parse((concept as any).reelUrls || "[]"); } catch {}
    const conn = concept.clientId ? await prisma.instagramConnection.findUnique({ where: { clientId: concept.clientId } }) : null;
    const tok = (u: string) => ((u || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i)?.[1] || u || "").trim();
    const wanted = new Set(reelUrls.map(tok));
    const matched: Record<string, any> = {};
    let url: string | null = conn?.accessToken
      ? `https://graph.instagram.com/v21.0/me/media?fields=id,permalink,thumbnail_url,media_url,media_type&limit=50&access_token=${conn.accessToken}`
      : null;
    let pages = 0, totalMedia = 0;
    while (url && pages < 12) {
      pages++;
      let data: any;
      try { data = await (await fetch(url)).json(); } catch { break; }
      if (!data?.data) break;
      totalMedia += data.data.length;
      for (const m of data.data) {
        const t = tok(m.permalink || "");
        if (wanted.has(t) && !matched[t]) matched[t] = m;
      }
      url = data.paging?.next || null;
    }
    return NextResponse.json({
      conceptName: concept.name,
      clientId: concept.clientId,
      igConnected: !!conn?.accessToken,
      reelUrls,
      wantedTokens: [...wanted],
      matchedTokens: Object.keys(matched),
      matchedCount: Object.keys(matched).length,
      totalClientMediaScanned: totalMedia,
      sampleMatched: Object.values(matched)[0]
        ? { id: (Object.values(matched)[0] as any).id, hasThumb: !!(Object.values(matched)[0] as any).thumbnail_url, mediaType: (Object.values(matched)[0] as any).media_type }
        : null,
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

  // ?simprobe=handle — inspect the "similar accounts" endpoint response shape
  const simprobe = req.nextUrl.searchParams.get("simprobe");
  if (simprobe) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return NextResponse.json({ error: "no key" });
    const host = "instagram-scraper-stable-api.p.rapidapi.com";
    try {
      const r = await fetch(`https://${host}/get_ig_similar_accounts.php?username_or_url=${encodeURIComponent(simprobe.replace(/^@/, ""))}`, {
        method: "GET",
        headers: { "x-rapidapi-host": host, "x-rapidapi-key": key },
      });
      const j = await r.json();
      const topKeys = j && typeof j === "object" ? Object.keys(j) : [];
      let arrPath: string | null = null; let sample: unknown = null;
      const scan = (o: any, prefix: string) => {
        if (arrPath || !o || typeof o !== "object") return;
        for (const k of Object.keys(o)) {
          if (Array.isArray(o[k]) && o[k].length) { arrPath = prefix + k; sample = o[k][0]; return; }
        }
        for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) scan(o[k], prefix + k + "."); if (arrPath) return; }
      };
      scan(j, "");
      return NextResponse.json({ httpStatus: r.status, topKeys, arrPath, sampleKeys: sample && typeof sample === "object" ? Object.keys(sample) : sample, sample, raw: arrPath ? undefined : j });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?findprobe=handle — inspect the raw following-list scraper response shape (debug the finder)
  const findprobe = req.nextUrl.searchParams.get("findprobe");
  if (findprobe) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return NextResponse.json({ error: "no key" });
    const host = "instagram-scraper-stable-api.p.rapidapi.com";
    const dataParam = req.nextUrl.searchParams.get("data") || "following";
    const ep = req.nextUrl.searchParams.get("ep") || "get_ig_user_followers_v2.php";
    try {
      const body = new URLSearchParams({ username_or_url: findprobe.replace(/^@/, ""), data: dataParam, amount: "10" });
      const r = await fetch(`https://${host}/${ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "x-rapidapi-host": host, "x-rapidapi-key": key },
        body: body.toString(),
      });
      const j = await r.json();
      const topKeys = j && typeof j === "object" ? Object.keys(j) : [];
      // find the first array in the response + a sample item
      let arrPath: string | null = null;
      let sample: unknown = null;
      for (const k of topKeys) {
        if (Array.isArray((j as any)[k])) { arrPath = k; sample = (j as any)[k][0]; break; }
        const inner = (j as any)[k];
        if (inner && typeof inner === "object") {
          for (const k2 of Object.keys(inner)) {
            if (Array.isArray(inner[k2])) { arrPath = `${k}.${k2}`; sample = inner[k2][0]; break; }
          }
        }
        if (arrPath) break;
      }
      return NextResponse.json({ httpStatus: r.status, topKeys, arrPath, sampleItemKeys: sample && typeof sample === "object" ? Object.keys(sample) : sample, sample, raw: j });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?draftex=clientId — recent drafts with their exampleVideoUrl (debug the reel→kanban handoff)
  const draftex = req.nextUrl.searchParams.get("draftex");
  if (draftex) {
    const drafts = await prisma.scriptDraft.findMany({
      where: { clientId: parseInt(draftex) }, orderBy: { generatedAt: "desc" }, take: 8,
      select: { id: true, title: true, status: true, exampleVideoUrl: true } as any,
    });
    return NextResponse.json(drafts.map((d: any) => ({ id: d.id, title: d.title, status: d.status, exampleVideoUrl: d.exampleVideoUrl })));
  }

  // ?r2cors=<origin> — simulate the browser's CORS preflight (OPTIONS) to the R2 upload
  // endpoint from a given origin, so we can see exactly which origins R2 allows to PUT.
  const r2corsOrigin = req.nextUrl.searchParams.get("r2cors");
  if (r2corsOrigin) {
    const acct = process.env.R2_ACCOUNT_ID, bucket = process.env.R2_BUCKET;
    if (!acct || !bucket) return NextResponse.json({ error: "R2 not configured" });
    const url = `https://${acct}.r2.cloudflarestorage.com/${bucket}/__corsprobe__.bin`;
    try {
      const r = await fetch(url, { method: "OPTIONS", headers: {
        Origin: r2corsOrigin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      }});
      return NextResponse.json({
        testedOrigin: r2corsOrigin,
        status: r.status,
        allowOrigin: r.headers.get("access-control-allow-origin"),
        allowMethods: r.headers.get("access-control-allow-methods"),
        allowHeaders: r.headers.get("access-control-allow-headers"),
        maxAge: r.headers.get("access-control-max-age"),
        allowed: r.status >= 200 && r.status < 300 && !!r.headers.get("access-control-allow-origin"),
      });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?boardstripembeds=<clientId> — remove ONLY embeddable (video) elements from a board's
  // saved snapshot, keeping every other element. Safe recovery for a board that crashes.
  const stripCid = req.nextUrl.searchParams.get("boardstripembeds");
  if (stripCid) {
    try {
      const board = await (prisma as any).board.findUnique({ where: { clientId: parseInt(stripCid) } });
      if (!board) return NextResponse.json({ error: "no board" });
      const snap = JSON.parse(board.snapshot || "{}");
      const before = (snap.elements || []).length;
      snap.elements = (snap.elements || []).filter((e: any) => e.type !== "embeddable");
      const removed = before - snap.elements.length;
      await (prisma as any).board.update({ where: { clientId: parseInt(stripCid) }, data: { snapshot: JSON.stringify(snap) } });
      return NextResponse.json({ ok: true, clientId: parseInt(stripCid), removed, remaining: snap.elements.length });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?boardinfo=1 — per-client board snapshot size + element type histogram (diagnose crashes)
  if (req.nextUrl.searchParams.get("boardinfo")) {
    try {
      const rows = await (prisma as any).$queryRawUnsafe(`SELECT "clientId", length(snapshot) AS len, snapshot FROM "Board" ORDER BY length(snapshot) DESC;`);
      const out = rows.map((r: any) => {
        let elements = 0; const types: Record<string, number> = {}; let files = 0; let embeds: string[] = [];
        try {
          const snap = JSON.parse(r.snapshot || "{}");
          const els = snap.elements || [];
          elements = els.length;
          for (const e of els) { types[e.type] = (types[e.type] || 0) + 1; if (e.type === "embeddable" && e.link) embeds.push(String(e.link).slice(0, 60)); }
          files = snap.files ? Object.keys(snap.files).length : 0;
        } catch { /* ignore */ }
        return { clientId: r.clientId, snapshotKB: Math.round(r.len / 1024), elements, types, files, embedCount: embeds.length, embeds: embeds.slice(0, 8) };
      });
      return NextResponse.json({ boards: out });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }

  // ?zsched=1 — list drafts that are booked / have a Zernio post id.
  if (req.nextUrl.searchParams.get("zsched")) {
    try {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT id, title, "scheduledDate", "zernioBooked", "zernioPostId" FROM "ScriptDraft" WHERE "zernioPostId" IS NOT NULL OR "zernioBooked" = true ORDER BY "scheduledDate" DESC LIMIT 30;`
      );
      return NextResponse.json({ drafts: rows });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }
  // ?zlist=<path> — probe a Zernio list endpoint (default /posts) to recover post ids.
  const zlist = req.nextUrl.searchParams.get("zlist");
  if (zlist) {
    const base = "https://zernio.com/api/v1";
    const key = process.env.ZERNIO_API_KEY;
    const path = zlist === "1" ? "/posts" : zlist;
    try {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      const text = await r.text();
      return NextResponse.json({ path, status: r.status, body: text.slice(0, 2000) });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }
  // ?zfindall=1 — compact list of all Zernio posts (id, scheduledFor, content snippet, media)
  if (req.nextUrl.searchParams.get("zfindall")) {
    const base = "https://zernio.com/api/v1";
    const key = process.env.ZERNIO_API_KEY;
    try {
      const r = await fetch(`${base}/posts`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      const j = await r.json();
      const posts: any[] = Array.isArray(j) ? j : (j.posts || j.data || []);
      return NextResponse.json({ count: posts.length, posts: posts.map((p) => ({
        id: p._id ?? p.id,
        scheduledFor: p.scheduledFor ?? p.scheduledAt ?? p.publishAt ?? p.scheduledDate ?? null,
        status: p.status ?? null,
        content: String(p.content || "").slice(0, 50),
        media: (p.mediaItems || p.media || [])[0]?.url ?? null,
      })) });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
  }
  // ?zget=<postId> / ?zdel=<postId> — probe Zernio's real GET/DELETE response for a post.
  const zget = req.nextUrl.searchParams.get("zget");
  const zdel = req.nextUrl.searchParams.get("zdel");
  if (zget || zdel) {
    const base = "https://zernio.com/api/v1";
    const key = process.env.ZERNIO_API_KEY;
    const id = (zget || zdel)!;
    try {
      const r = await fetch(`${base}/posts/${id}`, {
        method: zdel ? "DELETE" : "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const text = await r.text();
      return NextResponse.json({ action: zdel ? "DELETE" : "GET", postId: id, status: r.status, body: text.slice(0, 800) });
    } catch (e) { return NextResponse.json({ error: String(e) }); }
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

  // ?candcount=1 — count CompetitorCandidate rows grouped by clientId + status
  if (req.nextUrl.searchParams.get("candcount")) {
    try {
      const rows = await (prisma as any).$queryRawUnsafe(
        `SELECT "clientId", status, COUNT(*)::int AS n FROM "CompetitorCandidate" GROUP BY "clientId", status ORDER BY "clientId";`
      );
      const clients = await (prisma as any).$queryRawUnsafe(`SELECT id, name FROM "Client" ORDER BY id;`);
      return NextResponse.json({ candidates: rows, clients });
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

  // ?delmsgchannel=clientId:channel — delete a stale/orphaned message thread
  const delMsg = req.nextUrl.searchParams.get("delmsgchannel");
  if (delMsg) {
    const [cid, ...rest] = delMsg.split(":");
    const channel = rest.join(":");
    const { count } = await (prisma as any).message.deleteMany({ where: { clientId: parseInt(cid), channel } });
    return NextResponse.json({ ok: true, deleted: count });
  }

  // ?msgs=1 — dump recent messages (clientId, channel, author) to debug chat routing
  if (req.nextUrl.searchParams.get("msgs")) {
    const ms = await (prisma as any).message.findMany({ orderBy: { id: "desc" }, take: 20 });
    return NextResponse.json(ms.map((m: any) => ({
      id: m.id, clientId: m.clientId, channel: m.channel, author: m.author,
      content: (m.content || "").slice(0, 40),
    })));
  }

  // ?wipeclienttasks=clientId — delete all client-written script drafts for a client
  // (resets the Script Tasks page to a clean slate). Leaves AI-generated drafts.
  const wipeTasks = req.nextUrl.searchParams.get("wipeclienttasks");
  if (wipeTasks) {
    const cid = parseInt(wipeTasks);
    const { count } = await (prisma as any).scriptDraft.deleteMany({
      where: { clientId: cid, clientAuthored: true },
    });
    return NextResponse.json({ ok: true, deleted: count });
  }

  // ?drafts=clientId — dump script drafts with clientAuthored/status/feedback for debugging
  const draftsDump = req.nextUrl.searchParams.get("drafts");
  if (draftsDump) {
    const cid = parseInt(draftsDump);
    const ds = await prisma.scriptDraft.findMany({
      where: { clientId: cid, isSavedIdea: false },
      orderBy: { generatedAt: "desc" }, take: 30,
      select: { id: true, title: true, status: true, stageId: true, clientAuthored: true, rejectionFeedback: true, conceptId: true, generatedAt: true, zernioBooked: true, zernioPostId: true, scheduledDate: true, editedVideoUrl: true } as any,
    });
    return NextResponse.json(ds);
  }

  // ?retitle=clientId — replace any "… — imported" titles with a real title derived
  // from the hook/script first words (no more "imported" anywhere).
  const retitle = req.nextUrl.searchParams.get("retitle");
  if (retitle) {
    const cid = parseInt(retitle);
    const ds = await prisma.scriptDraft.findMany({
      where: { clientId: cid, title: { contains: "imported" } },
      select: { id: true, script: true, hook: true } as any,
    });
    const out: any[] = [];
    for (const d of ds as any[]) {
      const src = String(d.hook || d.script || "").trim();
      const newTitle = src ? src.split(/\n/)[0].split(/\s+/).slice(0, 8).join(" ") : "Script";
      await prisma.scriptDraft.update({ where: { id: d.id }, data: { title: newTitle } });
      out.push({ id: d.id, title: newTitle });
    }
    return NextResponse.json({ ok: true, updated: out.length, titles: out });
  }

  // ?zposts=clientId — fetch this client's Zernio posts (probe times/shape).
  const zposts = req.nextUrl.searchParams.get("zposts");
  if (zposts) {
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(zposts) } });
    const profileId = (conn as any)?.zernioProfileId || process.env.ZERNIO_PROFILE_ID;
    const tries = [
      `https://zernio.com/api/v1/posts?profileId=${profileId}&limit=50`,
      `https://zernio.com/api/v1/posts?limit=50`,
    ];
    for (const url of tries) {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, Accept: "application/json" } });
        const data = await r.json();
        if (r.ok) {
          const arr = Array.isArray(data) ? data : (data?.posts ?? data?.data ?? []);
          return NextResponse.json({ url, count: arr.length, sample: arr.slice(0, 12).map((p: any) => ({
            id: p._id ?? p.id, content: String(p.content ?? "").slice(0, 40),
            scheduledFor: p.scheduledFor ?? p.scheduledAt ?? p.scheduled_at, status: p.status, timezone: p.timezone,
          })) });
        }
      } catch { /* try next */ }
    }
    return NextResponse.json({ error: "zernio fetch failed" }, { status: 502 });
  }

  // ?zbackfill=clientId — recover lost scheduled TIMES from Zernio. Matches each booked
  // draft to its Zernio post by date and writes the real local (Europe/Amsterdam) time.
  const zbackfill = req.nextUrl.searchParams.get("zbackfill");
  if (zbackfill) {
    const cid = parseInt(zbackfill);
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
    const profileId = (conn as any)?.zernioProfileId || process.env.ZERNIO_PROFILE_ID;
    let posts: any[] = [];
    try {
      const r = await fetch(`https://zernio.com/api/v1/posts?profileId=${profileId}&limit=100`, {
        headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, Accept: "application/json" },
      });
      const data = await r.json();
      posts = Array.isArray(data) ? data : (data?.posts ?? data?.data ?? []);
    } catch { return NextResponse.json({ error: "zernio fetch failed" }, { status: 502 }); }

    // Local Amsterdam date + time of a Zernio scheduledFor (stored UTC).
    const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => {
      try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", ...opts }).format(new Date(iso)); } catch { return ""; }
    };
    // Build date -> "HH:MM" map from Zernio posts (scheduled or published).
    const byDate: Record<string, string> = {};
    for (const p of posts) {
      const iso = p.scheduledFor ?? p.scheduledAt ?? p.scheduled_at;
      if (!iso) continue;
      const date = fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" }); // YYYY-MM-DD
      const time = fmt(iso, { hour: "2-digit", minute: "2-digit", hour12: false });   // HH:MM
      if (date && time) byDate[date] = time;
    }

    const drafts = await prisma.scriptDraft.findMany({
      where: { clientId: cid, scheduledDate: { not: null } },
      select: { id: true, title: true, scheduledDate: true } as any,
    });
    const out: any[] = [];
    for (const d of drafts as any[]) {
      const date = (d.scheduledDate || "").slice(0, 10);
      const time = byDate[date];
      if (!time) continue;
      const newSched = `${date}T${time}`;
      if (d.scheduledDate === newSched) continue;
      await (prisma as any).scriptDraft.update({ where: { id: d.id }, data: { scheduledDate: newSched } });
      out.push({ id: d.id, title: d.title, was: d.scheduledDate, now: newSched });
    }
    return NextResponse.json({ ok: true, updated: out.length, changes: out, datesFound: Object.keys(byDate).length });
  }

  // ?blobcheck=1 — is the Vercel Blob token configured?
  if (req.nextUrl.searchParams.get("blobcheck")) {
    return NextResponse.json({ hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN });
  }

  // ?blobtest=1 — actually write a tiny file to Blob to confirm the token works.
  if (req.nextUrl.searchParams.get("blobtest")) {
    try {
      const { put } = await import("@vercel/blob");
      const r = await put(`diag/test.txt`, "ok", { access: "public", allowOverwrite: true });
      return NextResponse.json({ ok: true, url: r.url });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  // ?cloudtest=1 — server-side unsigned Cloudinary upload to see the REAL error
  // (browser CORS masks it). Uploads a tiny 1x1 png.
  if (req.nextUrl.searchParams.get("cloudtest")) {
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const form = new FormData();
    form.append("file", `data:image/png;base64,${pngB64}`);
    form.append("upload_preset", preset || "");
    const endpoint = req.nextUrl.searchParams.get("cloudtest") === "video" ? "video" : "image";
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${endpoint}/upload`, { method: "POST", body: form });
    const body = await r.text();
    return NextResponse.json({ cloud, preset, endpoint, status: r.status, ok: r.ok, body: body.slice(0, 1200) });
  }

  // ?settime=draftId-HH:MM — set a draft's scheduled TIME (keeps its date). For booked
  // cards that lost their time before we started storing it.
  const setTime = req.nextUrl.searchParams.get("settime");
  if (setTime) {
    const [idStr, time] = setTime.split("-");
    const d = await prisma.scriptDraft.findUnique({ where: { id: parseInt(idStr) }, select: { scheduledDate: true } as any });
    const datePart = ((d as any)?.scheduledDate || "").slice(0, 10);
    if (!datePart || !/^\d{2}:\d{2}$/.test(time || "")) return NextResponse.json({ error: "need ?settime=draftId-HH:MM and an existing date" }, { status: 400 });
    const updated = await (prisma as any).scriptDraft.update({
      where: { id: parseInt(idStr) },
      data: { scheduledDate: `${datePart}T${time}` },
      select: { id: true, title: true, scheduledDate: true },
    });
    return NextResponse.json({ ok: true, draft: updated });
  }

  // ?markposted=draftId — manually flip a script draft to status:"posted" (greens its
  // calendar card). For posts published before the Zernio post-id link existed.
  const markPosted = req.nextUrl.searchParams.get("markposted");
  if (markPosted) {
    const d = await (prisma as any).scriptDraft.update({
      where: { id: parseInt(markPosted) },
      data: { status: "posted" },
      select: { id: true, title: true, status: true },
    });
    return NextResponse.json({ ok: true, draft: d });
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
  if (!isAdminToken(secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Competitor Finder candidates table
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CompetitorCandidate" (
        "id" SERIAL PRIMARY KEY,
        "clientId" INTEGER NOT NULL,
        "handle" TEXT NOT NULL,
        "name" TEXT,
        "followerCount" INTEGER,
        "profilePicUrl" TEXT,
        "matched" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await (prisma as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CompetitorCandidate_clientId_handle_key" ON "CompetitorCandidate"("clientId","handle");`);
    await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CompetitorCandidate_clientId_status_idx" ON "CompetitorCandidate"("clientId","status");`);
    await (prisma as any).$executeRawUnsafe(`ALTER TABLE "CompetitorCandidate" ADD COLUMN IF NOT EXISTS "gender" TEXT;`);
    await (prisma as any).$executeRawUnsafe(`ALTER TABLE "CompetitorCandidate" ADD COLUMN IF NOT EXISTS "language" TEXT;`);
    await (prisma as any).$executeRawUnsafe(`ALTER TABLE "CompetitorCandidate" ADD COLUMN IF NOT EXISTS "bio" TEXT;`);
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PushSubscription" (
        "id" SERIAL PRIMARY KEY,
        "endpoint" TEXT NOT NULL UNIQUE,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "subscriberType" TEXT NOT NULL DEFAULT 'owner',
        "memberId" INTEGER,
        "clientId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await (prisma as any).$executeRaw`
      ALTER TABLE "DraftNote"
      ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "isRemix" BOOLEAN NOT NULL DEFAULT false;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "hookAlternatives" TEXT NOT NULL DEFAULT '[]';
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "exampleLink" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "exampleReelId" INTEGER;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "exampleThumbnail" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "Client"
      ADD COLUMN IF NOT EXISTS "hideFromHq" BOOLEAN NOT NULL DEFAULT false;
    `;
    // Per-client YouTube toggle (YouTube Kanban + Clipping). Same as GET ?youtubecol=1.
    await (prisma as any).$executeRaw`
      ALTER TABLE "Client"
      ADD COLUMN IF NOT EXISTS "youtubeEnabled" BOOLEAN NOT NULL DEFAULT false;
    `;
    // Clipping: the long-form draft a short clip was cut from. Same as GET ?clipcol=1.
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft"
      ADD COLUMN IF NOT EXISTS "clipOfDraftId" INTEGER;
    `;
    await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ScriptDraft_clipOfDraftId_idx" ON "ScriptDraft"("clipOfDraftId");`);
    // Headquarters: activity log + nightly reel snapshots.
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ActivityEvent" (
        "id" SERIAL PRIMARY KEY,
        "clientId" INTEGER,
        "actor" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT,
        "detail" TEXT,
        "draftId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");`);
    await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ActivityEvent_clientId_createdAt_idx" ON "ActivityEvent"("clientId","createdAt");`);
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ReelSnapshot" (
        "id" SERIAL PRIMARY KEY,
        "clientId" INTEGER NOT NULL,
        "reelId" TEXT NOT NULL,
        "plays" INTEGER NOT NULL DEFAULT 0,
        "likes" INTEGER NOT NULL DEFAULT 0,
        "comments" INTEGER NOT NULL DEFAULT 0,
        "takenAt" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await (prisma as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ReelSnapshot_clientId_reelId_takenAt_key" ON "ReelSnapshot"("clientId","reelId","takenAt");`);
    await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReelSnapshot_clientId_takenAt_idx" ON "ReelSnapshot"("clientId","takenAt");`);
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
      ADD COLUMN IF NOT EXISTS "postDays" TEXT;
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
      ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "captionGuidelines" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "clientAuthored" BOOLEAN NOT NULL DEFAULT false;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "zernioBooked" BOOLEAN NOT NULL DEFAULT false;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "zernioPostId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "rejectionFeedback" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ScriptDraft" ADD COLUMN IF NOT EXISTS "exampleVideoUrl" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "mediaUrlAt" TIMESTAMP(3);
      ALTER TABLE "CompetitorReel" ADD COLUMN IF NOT EXISTS "cachedVideoUrl" TEXT;
    `;
    // Capture-once columns are added via the isolated ?reelcols=1 branch (single-statement,
    // Neon-safe) to avoid multi-statement prepared-query failures 500-ing the whole migration.
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
