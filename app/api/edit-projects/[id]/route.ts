import { NextRequest, NextResponse } from "next/server";
import { getProject, saveDocument } from "@/features/editor/server/projects";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";

// GET /api/edit-projects/:id → { project }
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ project });
}

// PUT /api/edit-projects/:id  { document, version } — saves the document if the row is still at
// `version` (the version the client loaded). 409 with the current project otherwise, so the
// editor can show who saved in between instead of silently overwriting their work.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const projectId = parseInt(id, 10);
  const current = await getProject(projectId);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, current.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.version !== "number" || !body.document) {
    return NextResponse.json({ error: "document and version required" }, { status: 400 });
  }
  const result = await saveDocument(projectId, body.document, body.version, session.name || null);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: "conflict", project: result.conflict }, { status: 409 });
  return NextResponse.json({ project: result.project });
}
