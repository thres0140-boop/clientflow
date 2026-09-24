// Shape of a render job as the editor sees it when it polls. Client-safe.

export type RenderJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export const RENDER_JOB_ACTIVE: ReadonlySet<RenderJobStatus> = new Set(["queued", "running"]);

export type RenderJobView = {
  id: number;
  projectId: number;
  documentVersion: number;
  status: RenderJobStatus;
  progress: number;          // 0..100, best effort
  outputUrl: string | null;  // the R2 url of the finished MP4 once status === "done"
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** How often the editor should poll a job. Renders take tens of seconds, so 2 s is plenty and
 *  keeps a backgrounded iOS tab from hammering the API when it wakes up. */
export const RENDER_JOB_POLL_MS = 2000;
