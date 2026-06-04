import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/clients/[id]/caption-guidelines
// Pulls the captions from the client's ~15 most recent reels (own connected IG
// account, via Graph API) and derives reusable caption-writing guidelines from
// them (opening/text style, CTA style, length, emoji, hashtags, formatting).
// Stores the result on Client.captionGuidelines.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = parseInt(id);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId } });
  if (!conn?.accessToken) return NextResponse.json({ error: "Instagram not connected for this client." }, { status: 400 });

  // Walk media pages until we have 15 reel captions (or run out).
  const captions: string[] = [];
  let url: string | null = `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_product_type&limit=50&access_token=${conn.accessToken}`;
  let pages = 0;
  while (url && pages < 4 && captions.length < 15) {
    pages++;
    let data: any;
    try { data = await (await fetch(url)).json(); } catch { break; }
    if (data?.error) return NextResponse.json({ error: data.error.message }, { status: 400 });
    if (!data?.data) break;
    for (const m of data.data) {
      const isReel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
      const cap = (m.caption || "").trim();
      if (isReel && cap.length > 10 && captions.length < 15) captions.push(cap);
    }
    url = data.paging?.next || null;
  }

  if (captions.length < 3) {
    return NextResponse.json({ error: `Only found ${captions.length} reel caption(s) on this account — need a few more posted reels to learn from.` }, { status: 400 });
  }

  const langLine = client.language === "nl" ? "The captions are in Dutch; write the guidelines in English but keep example phrasings in Dutch." : "";
  const numbered = captions.map((c, i) => `--- Caption ${i + 1} ---\n${c}`).join("\n\n");

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: `You analyze a creator's real Instagram reel captions and extract a reusable CAPTION PLAYBOOK so an AI can write new captions in exactly their style. ${langLine}

Study the real captions and output guidelines under these exact headings (skip a heading only if there's truly no signal):

OPENING / TEXT
- How the first line works (hook? statement? question?), typical length, tone.

BODY
- Structure, line-break/whitespace habits, sentence length, how they build the point.

CTA
- Their typical call-to-action (comment a word, save this, DM, follow, link in bio…) and exact phrasings they reuse.

EMOJI & FORMATTING
- Emoji usage (which, how many, where), capitalization, punctuation quirks.

HASHTAGS
- Whether they use them, how many, placement.

LENGTH & VOICE
- Typical caption length and overall voice (1-2 sentences).

Be concrete and specific to THIS creator — quote recurring phrases. Output ONLY the playbook, no preamble.`,
    messages: [{ role: "user", content: `Here are ${captions.length} of this creator's real reel captions:\n\n${numbered}\n\nWrite their caption playbook.` }],
  });

  const guidelines = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  await prisma.client.update({ where: { id: clientId }, data: { captionGuidelines: guidelines } as any });

  return NextResponse.json({ ok: true, guidelines, sampled: captions.length });
}
