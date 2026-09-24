import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { cancelJob, refreshJob } from "@/features/editor/server/jobs";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";

async function guard(req: NextRequest, id: string): Promise<NextResponse | number> {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobId = parseInt(id, 10);
  const row = await prisma.renderJob.findUnique({ where: { id: jobId }, select: { project: { select: { clientId: true } } } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, row.project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return jobId;
}

// GET /api/render-jobs/:id — poll. While the job runs this asks the executor and updates the
// row; once terminal it is served from the row. Poll every RENDER_JOB_POLL_MS.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (typeof g !== "number") return g;
  const job = await refreshJob(g);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

// DELETE /api/render-jobs/:id — cancel (best effort; a finished job stays finished).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, id);
  if (typeof g !== "number") return g;
  const job = await cancelJob(g);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
