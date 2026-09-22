import { NextRequest, NextResponse } from "next/server";
import { fetchTikTokZernio } from "@/features/tiktok/server/tiktokZernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/analytics?clientId= — organic TikTok analytics via Zernio (the platform ORDO
// already uses for Instagram). Returns follower history/growth, per-video metrics, profile views,
// and aggregate totals. Requires the client's TikTok account to be linked in Settings → Connections.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ connected: false });
  const days = Math.min(89, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") || "30") || 30));
  const data = await fetchTikTokZernio(parseInt(clientId), days);
  return NextResponse.json(data);
}
