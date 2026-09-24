// RenderJob rows and the executor hand-off. The routes call these; the executor never sees a row.
import { prisma } from "@/shared/db/prisma";
import { documentDurationMs, type EditDocument } from "@/features/editor/model/document";
import { RENDER_JOB_ACTIVE, type RenderJobStatus, type RenderJobView } from "@/features/editor/model/renderJob";
import { getRenderExecutor, RENDER_LIMITS, type RenderPlan } from "./executor";

type JobRow = { id: number; projectId: number; documentVersion: number; status: string; progress: number; outputUrl: string | null; error: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null };

export function toJobView(row: JobRow): RenderJobView {
  return {
    id: row.id, projectId: row.projectId, documentVersion: row.documentVersion, status: row.status as RenderJobStatus,
    progress: row.progress, outputUrl: row.outputUrl, error: row.error,
    createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function activeJobForProject(projectId: number): Promise<RenderJobView | null> {
  const row = await prisma.renderJob.findFirst({ where: { projectId, status: { in: [...RENDER_JOB_ACTIVE] } }, orderBy: { createdAt: "desc" } });
  return row ? toJobView(row) : null;
}

export type StartResult = { ok: true; job: RenderJobView; reused: boolean } | { ok: false; status: 422 | 500; error: string };

/** Admits, records and starts a render. Refuses timelines over the ceiling before spending
 *  anything; returns the already-running job instead of starting a second one. */
export async function startRender(project: { id: number; version: number; document: EditDocument }, requestedBy: string | null): Promise<StartResult> {
  const durationMs = documentDurationMs(project.document);
  if (durationMs <= 0) return { ok: false, status: 422, error: "The timeline is empty." };
  if (durationMs > RENDER_LIMITS.MAX_TIMELINE_MS) {
    return { ok: false, status: 422, error: `The timeline is ${Math.round(durationMs / 60000)} min; the ceiling is ${RENDER_LIMITS.MAX_TIMELINE_MS / 60000} min per export.` };
  }
  if (RENDER_LIMITS.ONE_ACTIVE_JOB_PER_PROJECT) {
    const active = await activeJobForProject(project.id);
    if (active) return { ok: true, job: active, reused: true };
  }
  const executor = await getRenderExecutor();
  const job = await prisma.renderJob.create({ data: { projectId: project.id, documentVersion: project.version, executor: executor.name, requestedBy } });
  try {
    const plan = await buildRenderPlan(job.id, project.document);
    const { ref } = await executor.start(plan);
    const running = await prisma.renderJob.update({ where: { id: job.id }, data: { status: "running", executorRef: ref, outputKey: plan.output.key, startedAt: new Date() } });
    return { ok: true, job: toJobView(running), reused: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failed = await prisma.renderJob.update({ where: { id: job.id }, data: { status: "failed", error: msg, finishedAt: new Date() } });
    return { ok: false, status: 500, error: failed.error || msg };
  }
}

/** Refreshes a running job from its executor. Terminal jobs are returned as they are. */
export async function refreshJob(id: number): Promise<RenderJobView | null> {
  const row = await prisma.renderJob.findUnique({ where: { id } });
  if (!row) return null;
  if (row.status !== "running" || !row.executorRef) return toJobView(row);
  const executor = await getRenderExecutor();
  try {
    const p = await executor.poll(row.executorRef);
    if (p.state === "running") {
      const u = await prisma.renderJob.update({ where: { id }, data: { progress: p.progress ?? row.progress } });
      return toJobView(u);
    }
    if (p.state === "done") {
      const u = await prisma.renderJob.update({ where: { id }, data: { status: "done", progress: 100, outputUrl: row.outputKey ? publicUrlForKey(row.outputKey) : null, finishedAt: new Date() } });
      return toJobView(u);
    }
    const u = await prisma.renderJob.update({ where: { id }, data: { status: "failed", error: p.error, finishedAt: new Date() } });
    return toJobView(u);
  } catch (e) {
    // The executor could not be reached; the job is not failed, the poll is. Report the row as is.
    return toJobView({ ...row, error: row.error ?? `poll: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export async function cancelJob(id: number): Promise<RenderJobView | null> {
  const row = await prisma.renderJob.findUnique({ where: { id } });
  if (!row) return null;
  if (!RENDER_JOB_ACTIVE.has(row.status as RenderJobStatus)) return toJobView(row);
  if (row.executorRef) {
    const executor = await getRenderExecutor();
    await executor.cancel(row.executorRef).catch(() => {});
  }
  const u = await prisma.renderJob.update({ where: { id }, data: { status: "cancelled", finishedAt: new Date() } });
  return toJobView(u);
}

function publicUrlForKey(key: string): string {
  return `${(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "")}/${key}`;
}

/** Turns the document into what an executor needs: input urls, font urls, a presigned output
 *  PUT. Phase 4 fills this in (it is the same presign the multipart/presign routes do, minus the
 *  HTTP layer); until then no plan can be built, so no job can start. */
async function buildRenderPlan(jobId: number, document: EditDocument): Promise<RenderPlan> {
  void document;
  throw new Error(`buildRenderPlan is implemented in Phase 4 (job ${jobId})`);
}
