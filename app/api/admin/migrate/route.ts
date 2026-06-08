import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchProfileInfo, freshReelMediaUrl } from "@/lib/scrapeCompetitors";
import { joinExamples } from "@/lib/conceptExamples";

// GET — debug: show all instagram connections + lead counts
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token");
  if (secret !== "zernio-migrate-2024") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
