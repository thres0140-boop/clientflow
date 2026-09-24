import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";
import { freshReelMediaUrl } from "@/ai/features/instagram/server/scrapeCompetitors";
import { cacheImageToR2 } from "@/ai/shared/media/r2";

export const runtime = "nodejs";
export const maxDuration = 120;

function weekLabel(): string {
  const d = new Date();
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
  return `Week ${week}`;
}

function shortcodeFrom(url?: string | null): string | null {
  const m = String(url || "").match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// POST /api/competitors/to-kanban
// Body: { reelId?, clientId, conceptId, script?, title?, mediaUrl?, permalink?, caption? }
// Creates a Script Kanban IDEA from a reel — a tracked COMPETITOR reel (by reelId) OR the
// client's OWN feed reel (by mediaUrl/permalink). The reel's video is cached to R2 and
// attached as the example-to-copy for whoever films it.
export async function POST(req: NextRequest) {
  const { reelId, clientId, conceptId, script, title, mediaUrl, permalink, caption } = await req.json();
  if (!clientId || !conceptId) {
    return NextResponse.json({ error: "clientId and conceptId are required" }, { status: 400 });
  }

  // Is this a tracked competitor reel? (own feed reels won't match — their id is an IG media id)
  const reel = reelId
    ? await (prisma as any).competitorReel.findUnique({
        where: { id: parseInt(String(reelId)) },
        include: { competitor: { select: { handle: true } } },
      }).catch(() => null)
    : null;

  // Resolve a fresh, playable video URL and cache it to R2 so the example stays playable
  // forever (IG CDN links expire). Falls back to the permalink if caching fails.
  let exampleVideoUrl: string | null = null;
  let exampleLink: string | null = null;
  let exampleReelId: number | null = null;
  let exampleThumbnail: string | null = null;
  let fallbackTitle = "Content idea";

  if (reel) {
    // Keep the reel id + thumbnail on the draft so the Kanban card can re-resolve a fresh
    // playable url (and pull stats/transcript) on demand — exactly like the Instagram tab.
    exampleReelId = reel.id;
    exampleThumbnail = reel.thumbnailUrl || null;
    // Prefer a permanent R2 copy we already own; else capture one now. Crucially, NEVER store
    // a bare Instagram permalink as the video src — it's an HTML page, not a file, so <video>
    // just shows black. If capture fails we leave the url null and the card resolves live.
    if (reel.cachedVideoUrl) {
      exampleVideoUrl = reel.cachedVideoUrl;
    } else {
      try {
        const fresh = await freshReelMediaUrl(reel.competitor?.handle || "", reel.shortcode);
        if (fresh) exampleVideoUrl = await cacheImageToR2(fresh, `comp-examples/${reel.id}.mp4`);
      } catch { /* leave null — card re-resolves via reel-media */ }
    }
    exampleLink = reel.permalink || (reel.shortcode ? `https://www.instagram.com/reel/${reel.shortcode}/` : null);
    fallbackTitle = reel.caption || fallbackTitle;
  } else {
    // Client's OWN feed reel — cache the media_url we were handed (fresh from the Graph API).
    if (!mediaUrl) return NextResponse.json({ error: "reel not found (no reelId match and no mediaUrl provided)" }, { status: 404 });
    const code = shortcodeFrom(permalink) || `own-${Date.now()}`;
    try { exampleVideoUrl = await cacheImageToR2(mediaUrl, `own-examples/${clientId}/${code}.mp4`); } catch { /* fall through */ }
    if (!exampleVideoUrl) exampleVideoUrl = mediaUrl;
    exampleLink = permalink || null;
    fallbackTitle = caption || fallbackTitle;
  }

  const scriptText = String(script || "").trim();
  const autoTitle = (scriptText.split(/\n/)[0] || fallbackTitle).split(/\s+/).slice(0, 8).join(" ");

  const draft = await prisma.scriptDraft.create({
    data: {
      clientId: parseInt(String(clientId)),
      conceptId: parseInt(String(conceptId)),
      title: (title && String(title).trim()) || autoTitle,
      script: scriptText,
      caption: null,
      weekLabel: weekLabel(),
      exampleVideoUrl,
      exampleLink,
      exampleReelId,
      exampleThumbnail,
      status: "pending",   // → Ideas column
      isSavedIdea: false,
    } as any,
  });

  return NextResponse.json({ ok: true, draftId: draft.id, exampleVideoUrl });
}
