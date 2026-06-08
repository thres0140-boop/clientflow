import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";
import { cacheImageToR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 120;

function weekLabel(): string {
  const d = new Date();
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
  return `Week ${week}`;
}

// POST /api/competitors/to-kanban
// Body: { reelId, clientId, conceptId, script, title? }
// Creates a Script Kanban IDEA from a competitor reel: the (translated) script becomes
// the idea's script, and the competitor's actual IG video is cached to R2 and attached
// as the example-to-copy for whoever films it.
export async function POST(req: NextRequest) {
  const { reelId, clientId, conceptId, script, title } = await req.json();
  if (!reelId || !clientId || !conceptId) {
    return NextResponse.json({ error: "reelId, clientId and conceptId are required" }, { status: 400 });
  }
  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(String(reelId)) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return NextResponse.json({ error: "reel not found" }, { status: 404 });

  // Resolve a fresh, playable video URL (stored ones expire) and cache it to R2 so the
  // example stays playable forever. Falls back to the permalink if anything fails.
  let exampleVideoUrl: string | null = null;
  try {
    const fresh = await freshReelMediaUrl(reel.competitor?.handle || "", reel.shortcode);
    if (fresh) exampleVideoUrl = await cacheImageToR2(fresh, `comp-examples/${reel.id}.mp4`);
  } catch { /* fall through */ }
  if (!exampleVideoUrl) exampleVideoUrl = reel.permalink || null;

  const scriptText = String(script || "").trim();
  const autoTitle = (scriptText.split(/\n/)[0] || reel.caption || "Competitor idea").split(/\s+/).slice(0, 8).join(" ");

  const draft = await prisma.scriptDraft.create({
    data: {
      clientId: parseInt(String(clientId)),
      conceptId: parseInt(String(conceptId)),
      title: (title && String(title).trim()) || autoTitle,
      script: scriptText,
      caption: null,
      weekLabel: weekLabel(),
      exampleVideoUrl,
      status: "pending",   // → Ideas column
      isSavedIdea: false,
    },
  });

  return NextResponse.json({ ok: true, draftId: draft.id, exampleVideoUrl });
}
