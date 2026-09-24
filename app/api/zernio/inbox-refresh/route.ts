import { NextRequest, NextResponse } from "next/server";
import { mirrorState, mirrorTablesExist, reconcileLight } from "@/features/instagram/server/inboxMirror";

export const maxDuration = 60;

// GET /api/zernio/inbox-refresh?clientId=X
// The inbox's refresh control: runs the light reconcile for one client (newest Zernio page,
// drifted threads refetched) under a short budget, then reports the mirror state. The page
// reloads the list afterwards. Falls through harmlessly when the mirror isn't migrated.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const cid = parseInt(clientId);
  if (!(await mirrorTablesExist())) return NextResponse.json({ ok: true, skipped: "mirror_not_migrated", mirror: await mirrorState(cid) });
  const result = await reconcileLight(cid, 25_000);
  return NextResponse.json({ ok: true, result, mirror: await mirrorState(cid) });
}
