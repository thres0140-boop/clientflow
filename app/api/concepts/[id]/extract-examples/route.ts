import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp";

// Pull the shortcode (or id) token out of an instagram URL: .../reel/<token>/
function tokenOf(url: string): string {
  const m = (url || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  return (m?.[1] || url || "").trim();
}

// POST /api/concepts/[id]/extract-examples
// For every reel attached to the concept (reelUrls), find the matching reel on the
// client's connected IG account, read its on-screen text (vision) — falling back to
// transcription — and append each as a Script Example. Dedupes against what's there.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conceptId = parseInt(id);

  const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  if (!concept.clientId) return NextResponse.json({ error: "Concept has no client" }, { status: 400 });

  let reelUrls: string[] = [];
  try { reelUrls = JSON.parse((concept as any).reelUrls || "[]"); } catch { reelUrls = []; }
  if (!reelUrls.length) return NextResponse.json({ error: "No reels attached to this concept." }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: concept.clientId } });
  if (!conn?.accessToken) return NextResponse.json({ error: "Instagram not connected for this client." }, { status: 400 });

  const origin = new URL(req.url).origin;
  const wantedTokens = new Set(reelUrls.map(tokenOf));

  // Walk the client's media pages, collecting reels that match the attached URLs.
  const matched: Record<string, any> = {};
  let url: string | null = `https://graph.instagram.com/v21.0/me/media?fields=${FIELDS}&limit=50&access_token=${conn.accessToken}`;
  let pages = 0;
  while (url && pages < 12 && Object.keys(matched).length < wantedTokens.size) {
    pages++;
    let data: any;
    try {
      const r = await fetch(url);
      data = await r.json();
    } catch { break; }
    if (!data?.data) break;
    for (const m of data.data) {
      const tok = tokenOf(m.permalink || "");
      if (wantedTokens.has(tok) && !matched[tok]) matched[tok] = m;
      else if (wantedTokens.has(m.id) && !matched[m.id]) matched[m.id] = m;
    }
    url = data.paging?.next || null;
  }

  // Existing examples — used to dedupe.
  const existing = (concept.scriptExamples || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  const added: string[] = [];
  const skipped: string[] = [];

  // Helper: read on-screen text via vision; fall back to transcription.
  async function extractText(m: any): Promise<string> {
    let text = "";
    if (m.thumbnail_url || m.media_url) {
      try {
        const r = await fetch(`${origin}/api/instagram/read-text`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: m.thumbnail_url || m.media_url }),
        });
        const d = await r.json();
        text = (d.text || "").trim();
      } catch { /* ignore */ }
    }
    if (text.length < 8 && m.media_url) {
      try {
        const r = await fetch(`${origin}/api/instagram/transcribe`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaUrl: m.media_url }),
        });
        const d = await r.json();
        if (!d.error && (d.transcript || "").trim().length >= 8) text = d.transcript.trim();
      } catch { /* ignore */ }
    }
    return text;
  }

  for (const reelUrl of reelUrls) {
    const m = matched[tokenOf(reelUrl)] || matched[reelUrl];
    if (!m) { skipped.push(reelUrl); continue; }
    const text = await extractText(m);
    if (!text || text.length < 8) { skipped.push(reelUrl); continue; }
    if (seen.has(text.toLowerCase())) continue; // already an example
    seen.add(text.toLowerCase());
    added.push(text);
  }

  if (added.length) {
    const updated = [...existing, ...added].join("\n\n");
    await prisma.concept.update({ where: { id: conceptId }, data: { scriptExamples: updated } });
  }

  return NextResponse.json({
    ok: true,
    added: added.length,
    total: existing.length + added.length,
    matched: Object.keys(matched).length,
    attached: reelUrls.length,
    skipped: skipped.length,
  });
}
