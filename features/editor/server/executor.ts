// The render seam. The editor creates a RenderJob row and polls it; a RenderExecutor is the only
// thing that knows where the ffmpeg process runs. Nothing outside features/editor/server may
// import an executor implementation directly — go through getRenderExecutor().
//
// Lifecycle, as the API routes drive it (app/api/edit-projects/[id]/render, app/api/render-jobs/[id]):
//   1. POST render → RenderJob(status=queued) → buildRenderPlan(document) → executor.start(plan)
//      → RenderJob(status=running, executorRef=<opaque>) → respond with the job. The HTTP request
//      ends here; the render keeps going wherever the executor put it.
//   2. GET job while running → executor.poll(ref) → row updated → respond. The executor's own
//      process uploads the MP4 to plan.output.uploadUrl (a presigned R2 PUT, so no bytes ever
//      cross a Vercel function body) before it reports "done"; the app then only has to trust
//      plan.output.publicUrl.
//   3. DELETE job → executor.cancel(ref).
import type { EditDocument } from "@/features/editor/model/document";

export type RenderExecutorName = "sandbox";

/** Everything an executor needs to render one job, resolved by the app BEFORE start(). The plan
 *  is executor-independent on purpose: inputs are URLs, fonts are URLs, the output is a presigned
 *  PUT. An executor never touches the database. */
export type RenderPlan = {
  jobId: number;
  document: EditDocument;                                     // the exact version being rendered
  inputs: { assetId: string; url: string; fileName: string }[]; // R2 urls (or the /api/vid proxy) the runner downloads
  fonts: { family: string; fileName: string; url: string }[];  // the caption fonts, served from this app
  output: { key: string; uploadUrl: string; publicUrl: string; contentType: "video/mp4" };
  limits: { maxDurationMs: number; timeoutMs: number };       // the ceilings this job was admitted under
};

export type ExecutorPoll =
  | { state: "running"; progress: number | null; detail?: string }
  | { state: "done"; progress: 100 }
  | { state: "failed"; error: string };

export interface RenderExecutor {
  readonly name: RenderExecutorName;
  /** Starts the render and returns an opaque handle stored on RenderJob.executorRef. Must return
   *  quickly (seconds): the caller is an HTTP request. */
  start(plan: RenderPlan): Promise<{ ref: string }>;
  /** Cheap and safe to call every couple of seconds. */
  poll(ref: string): Promise<ExecutorPoll>;
  /** Best effort; a job that already finished stays finished. */
  cancel(ref: string): Promise<void>;
}

/** Ceilings every job is admitted under, whatever the executor. A timeline longer than
 *  MAX_TIMELINE_MS is refused at POST time with a 422 rather than discovered at minute 20. */
export const RENDER_LIMITS = {
  MAX_TIMELINE_MS: 15 * 60 * 1000,   // 15 min of footage; at the measured 0.23x realtime on 4 vCPU that is ~3.5 min of render
  TIMEOUT_MS: 20 * 60 * 1000,        // the runner is killed after this even if it is still going
  ONE_ACTIVE_JOB_PER_PROJECT: true,  // a second POST while one runs returns the running job instead of starting another
} as const;

/** The one place the implementation is chosen. RENDER_EXECUTOR is read so a future executor can
 *  be switched in per environment without touching the editor or the routes. */
export async function getRenderExecutor(): Promise<RenderExecutor> {
  const name = (process.env.RENDER_EXECUTOR || "sandbox") as RenderExecutorName;
  switch (name) {
    case "sandbox": {
      const { SandboxRenderExecutor } = await import("./sandboxExecutor");
      return new SandboxRenderExecutor();
    }
    default:
      throw new Error(`Unknown RENDER_EXECUTOR "${name}"`);
  }
}
