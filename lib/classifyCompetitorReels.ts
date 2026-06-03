import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID = ["talking_head", "text_overlay", "broll", "other"];

// Classify a single reel thumbnail's content FORMAT via Claude vision (cheap Haiku).
async function classifyOne(imageUrl: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrl) return null;
  try {
    const r = await fetch(imageUrl);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || "image/jpeg";
    const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(ct) ? ct : "image/jpeg") as any;
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } },
          { type: "text", text: `Classify this Instagram reel thumbnail's FORMAT. Reply with EXACTLY one word, nothing else:
- talking_head = a person talking to camera is the main subject (captions/subtitles are fine)
- text_overlay = large on-screen TEXT over footage is the dominant element (viral text-hook style), the person is not the focus or absent
- broll = footage/scenery, no talking person and no dominant text
- other = photo, carousel, or unclear
One word only.` },
        ],
      }],
    });
    const t = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").toLowerCase().replace(/[^a-z_]/g, "");
    return VALID.includes(t) ? t : "other";
  } catch {
    return null;
  }
}

// Classify up to `limit` reels that don't have a format yet. Bounded concurrency
// so we don't hammer the model or blow the function timeout.
export async function classifyUnclassified(limit = 300): Promise<{ classified: number; remaining: number }> {
  const reels = await (prisma as any).competitorReel.findMany({
    where: { format: null, thumbnailUrl: { not: null } },
    take: limit,
    select: { id: true, thumbnailUrl: true },
  });

  let classified = 0;
  const queue = [...reels];
  const CONCURRENCY = 6;

  async function worker() {
    while (queue.length) {
      const reel = queue.shift();
      if (!reel) break;
      const fmt = await classifyOne(reel.thumbnailUrl);
      if (fmt) {
        await (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { format: fmt } }).catch(() => {});
        classified++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reels.length || 1) }, () => worker()));

  const remaining = await (prisma as any).competitorReel.count({ where: { format: null, thumbnailUrl: { not: null } } });
  return { classified, remaining };
}
