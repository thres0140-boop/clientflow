import { NextRequest, NextResponse } from "next/server";
import { getOrCreateProjectForDraft } from "@/features/editor/server/projects";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";

// GET /api/edit-projects?draftId=<n> — the edit project for a draft, created on first open from
// the draft's rawContentUrls. Returns { project } with the parsed document and its version.
export async function GET(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const draftId = parseInt(req.nextUrl.searchParams.get("draftId") || "", 10);
  if (!Number.isFinite(draftId)) return NextResponse.json({ error: "draftId required" }, { status: 400 });
  const project = await getOrCreateProjectForDraft(draftId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ project });
}
