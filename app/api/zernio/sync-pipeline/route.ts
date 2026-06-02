import { NextRequest, NextResponse } from "next/server";
import { syncClientPipeline } from "@/lib/syncPipeline";

// GET /api/zernio/sync-pipeline?clientId=X
// On-demand sync for a single client — called when the Analytics / DM Pipeline page opens.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const result = await syncClientPipeline(parseInt(clientId));
  return NextResponse.json({ ok: true, ...result });
}
