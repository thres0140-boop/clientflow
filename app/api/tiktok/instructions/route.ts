import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { generateInstructions } from "@/features/tiktok/server/tiktokInstructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CACHE_MS = 12 * 3600 * 1000;

// GET /api/tiktok/instructions?clientId=[&refresh=1] — the per-client TikTok views playbook.
// Cached ~12h; ?refresh=1 forces a regenerate. TikTok-only; never reads Instagram data.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ connected: false });
  const cid = parseInt(clientId);
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  if (!force) {
    const cached: any = await (prisma as any).tikTokInstructions.findUnique({ where: { clientId: cid } }).catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_MS) {
      try { return NextResponse.json({ ...JSON.parse(cached.data), generatedAt: cached.generatedAt, cached: true }); } catch { /* regenerate */ }
    }
  }

  const result = await generateInstructions(cid);
  await (prisma as any).tikTokInstructions.upsert({ // eslint-disable-line @typescript-eslint/no-explicit-any
    where: { clientId: cid },
    update: { data: JSON.stringify(result), generatedAt: new Date() },
    create: { clientId: cid, data: JSON.stringify(result) },
  }).catch(() => {});
  return NextResponse.json({ ...result, cached: false });
}
