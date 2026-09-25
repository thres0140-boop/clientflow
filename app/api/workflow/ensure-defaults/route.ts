import { NextRequest, NextResponse } from "next/server";
import { ensureDefaultStages } from "@/features/scripts/server/ensureStages";

// POST { clientId, platform? = "instagram" } — make the board match the platform's canonical
// stage list (features/scripts/server/ensureStages.ts) and return the stages in order. Called
// on every Kanban load; the same seeder runs when a platform is switched on for a client.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const cid = parseInt(body.clientId);
  const platform = body.platform || "instagram";
  const stages = await ensureDefaultStages(cid, platform);
  return NextResponse.json(stages);
}
