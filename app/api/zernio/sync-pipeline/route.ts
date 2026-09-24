import { NextRequest, NextResponse } from "next/server";
import { syncClientPipeline } from "@/features/content/server/syncPipeline";

// GET /api/zernio/sync-pipeline?clientId=X
// On-demand sync for a single client — called when the Analytics / DM Pipeline page opens.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  // Short budget: the page is waiting. Anything left over is picked up by the 15-minute cron.
  const result = await syncClientPipeline(parseInt(clientId), { budgetMs: 15_000 });
  return NextResponse.json({ ok: true, ...result });
}
