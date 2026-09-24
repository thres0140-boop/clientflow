import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/features/editor/server/projects";
import { activeJobForProject, startRender } from "@/features/editor/server/jobs";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";
// Creating the sandbox and handing it the plan takes a second or two; the render itself does
// not run inside this request.
export const maxDuration = 60;

// POST /api/edit-projects/:id/render — starts a render of the SAVED document (save first; the
// job records which version it rendered). Returns { job, reused } — reused=true means a render
// of this project was already running and that one is returned instead of a second sandbox.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await startRender(project, session.name || null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ job: result.job, reused: result.reused }, { status: result.reused ? 200 : 202 });
}

// GET /api/edit-projects/:id/render — the active job for this project, if any ({ job: null } otherwise).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ job: await activeJobForProject(project.id) });
}
