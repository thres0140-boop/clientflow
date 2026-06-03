import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { addConceptExample } from "@/lib/conceptExamples";
import { classifyReelFormat } from "@/lib/classifyCompetitorReels";

// Transcribing several videos can take a while — give the function room.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp";

const HALLUCINATIONS = new Set([
  "thanks for watching", "thank you for watching", "thank you", "please subscribe",
  "like and subscribe", "see you next time", "bye", "you", "music", "[music]", "♪",
]);
function isHallucination(text: string): boolean {
  const norm = (text || "").toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
  return HALLUCINATIONS.has(norm);
}

// Read on-screen text from an image (reel cover/frame) via Claude vision.
async function readOnScreenText(imageUrl: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrl) return "";
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return "";
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/jpeg";
    const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(ct) ? ct : "image/jpeg") as any;
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } },
          { type: "text", text: "This is a frame from an Instagram reel that uses on-screen text overlay. Read and output ONLY the exact on-screen text shown, word for word, preserving line breaks. Do not describe the image or add commentary. If there is no readable text overlay, output nothing." },
        ],
      }],
    });
    return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  } catch { return ""; }
}

// Transcribe spoken audio via Whisper (fallback for talking-head reels).
async function transcribeAudio(mediaUrl: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !mediaUrl) return "";
  try {
    const vr = await fetch(mediaUrl);
    if (!vr.ok) return "";
    const buf = await vr.arrayBuffer();
    if (buf.byteLength / (1024 * 1024) > 24) return "";
    const fd = new FormData();
    fd.append("file", new File([buf], "reel.mp4", { type: "video/mp4" }));
    fd.append("model", "whisper-1");
    const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
    });
    const d = await wr.json();
    if (!wr.ok) return "";
    const t = (d.text || "").trim();
    return isHallucination(t) ? "" : t;
  } catch { return ""; }
}

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
  // replace=true wipes existing examples and rebuilds them fresh from the reels.
  const replace = (await req.json().catch(() => ({})))?.replace === true;

  const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  if (!concept.clientId) return NextResponse.json({ error: "Concept has no client" }, { status: 400 });

  let reelUrls: string[] = [];
  try { reelUrls = JSON.parse((concept as any).reelUrls || "[]"); } catch { reelUrls = []; }
  if (!reelUrls.length) return NextResponse.json({ error: "No reels attached to this concept." }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: concept.clientId } });
  if (!conn?.accessToken) return NextResponse.json({ error: "Instagram not connected for this client." }, { status: 400 });

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

  // Existing examples — used to dedupe (cleared in replace mode for a fresh rebuild).
  const existing = replace ? [] : (concept.scriptExamples || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  const added: string[] = [];
  const skipped: string[] = [];

  // Match the EXTRACTION method to the concept's format:
  //  - text-overlay / B-roll text-hook  → read the on-screen text (vision)
  //  - talking-head / spoken            → transcribe the full spoken script (Whisper)
  // Using the wrong method gives a short cover snippet for a talking video, or a
  // hallucinated transcript for a silent text reel — which is what went wrong before.
  const vt = (concept.videoType || "").toLowerCase();
  const struct = (concept.structure || "").toLowerCase();
  const guide = (concept.guidelines || "").toLowerCase();
  const isTextOverlay =
    (concept as any).textOverlay === true ||
    /broll|b-roll|text[\s_-]*overlay|text[\s_-]*hook|on[\s_-]*screen/.test(vt) ||
    /op\s*scherm|tekstkaart|text\s*card|on[\s-]*screen|overlay|regel\s*\d/.test(struct) ||
    /tekstkaart|op\s*scherm|text\s*card|geen\s*voice|no\s*voice/.test(guide);

  // Helper: extract the example text using the right primary method for this format.
  async function extractText(m: any): Promise<string> {
    if (isTextOverlay) {
      // On-screen text first; only transcribe if the cover had no readable text.
      let text = await readOnScreenText(m.thumbnail_url || m.media_url);
      if (text.length < 8) {
        const t = await transcribeAudio(m.media_url);
        if (t.length >= 8) text = t;
      }
      return text;
    }
    // Talking-head: transcribe the spoken script first; vision only as a fallback.
    let text = await transcribeAudio(m.media_url);
    if (text.length < 8) {
      const v = await readOnScreenText(m.thumbnail_url || m.media_url);
      if (v.length >= 8) text = v;
    }
    return text;
  }

  // Extract every reel in PARALLEL (each transcription/vision call is slow),
  // then dedupe sequentially to keep order stable.
  const extracted = await Promise.all(reelUrls.map(async (reelUrl) => {
    const m = matched[tokenOf(reelUrl)] || matched[reelUrl];
    if (!m) return { reelUrl, text: "" };
    try { return { reelUrl, text: await extractText(m) }; }
    catch { return { reelUrl, text: "" }; }
  }));

  for (const { reelUrl, text } of extracted) {
    if (!text || text.length < 8) { skipped.push(reelUrl); continue; }
    if (seen.has(text.toLowerCase())) continue; // already an example
    seen.add(text.toLowerCase());
    added.push(text);

    // Mirror into the provenance pool with the reel's classified format (for the
    // generator's dominant-format signal). Reel-derived examples are trusted (human_seed).
    const m = matched[tokenOf(reelUrl)] || matched[reelUrl];
    if (m) {
      let format: string | null = null;
      try { format = await classifyReelFormat(m.thumbnail_url || m.media_url); } catch { /* ignore */ }
      addConceptExample(conceptId, text, "human_seed", { reelShortcode: tokenOf(reelUrl), format }).catch(() => {});
    }
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
