import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID = ["talking_head", "text_overlay", "broll", "other"];

// Classify a single reel thumbnail's content FORMAT via Claude vision (cheap Haiku).
export async function classifyReelFormat(imageUrl: string): Promise<string | null> {
  return classifyOne(imageUrl);
}
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
          { type: "text", text: `Classify this Instagram reel thumbnail's FORMAT. Reply with EXACTLY one word, nothing else.

DECISION RULE (in order):
1. Is there a person visibly talking/speaking to the camera (face/upper body is a main subject)? → "talking_head". This wins even if there are big captions, subtitles, or a text hook on screen. Captions do NOT make it text_overlay.
2. Otherwise, is the frame mostly footage/scenery/objects with the message delivered as large ON-SCREEN TEXT, and NObody is talking to camera? → "text_overlay".
3. Otherwise, footage/scenery with no talking person and no dominant text? → "broll".
4. Photo, carousel, or unclear? → "other".

One word only: talking_head, text_overlay, broll, or other.` },
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
export async function classifyUnclassified(limit = 300, reset = false): Promise<{ classified: number; remaining: number }> {
  if (reset) {
    await (prisma as any).competitorReel.updateMany({ data: { format: null } });
  }
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
