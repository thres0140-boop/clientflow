// RenderExecutor backed by Vercel Sandbox (the Phase 0 decision): one Firecracker microVM per
// job, 4 vCPU / 8 GB, its own compute, no effect on the app's function tier.
//
// How it will work (Phase 4 fills in the bodies; the shape is fixed now):
//   start(plan)
//     Sandbox.create({ image, resources: { vcpus: 4 }, timeout: plan.limits.timeoutMs })
//     write a small runner script + the compiled captions .ass into the sandbox
//     runCommand("bash", ["-c", "<download inputs+fonts> && ffmpeg … && curl -X PUT <uploadUrl>"], { detached: true })
//     ref = JSON.stringify({ sandboxId, cmdId })          ← the function returns here, ~1 s in
//   poll(ref)
//     Sandbox.get({ sandboxId }) → getCommand(cmdId) → exitCode null = running (progress parsed
//     from the runner's stdout), 0 = done (the PUT already happened inside the sandbox), else failed
//     (stderr tail as the error); on done/failed the sandbox is stopped so memory billing ends.
//   cancel(ref)
//     Sandbox.get → stop().
//
// Auth: on Vercel the SDK picks up the project's OIDC token; nothing to configure. Locally it
// needs VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID (see run-sandbox.mjs in the spike).
// Image: a snapshot with a static ffmpeg (libass) preinstalled, so the 2.8 s install measured in
// Phase 0 does not repeat per job. The snapshot id lives in RENDER_SANDBOX_SNAPSHOT.
import type { ExecutorPoll, RenderExecutor, RenderPlan } from "./executor";

export type SandboxRef = { sandboxId: string; cmdId: string };

export const SANDBOX_RENDER_RESOURCES = { vcpus: 4 } as const;

export class SandboxRenderExecutor implements RenderExecutor {
  readonly name = "sandbox" as const;

  async start(plan: RenderPlan): Promise<{ ref: string }> {
    // Phase 4. The dependency (@vercel/sandbox) is added together with the runner so Phase 1
    // ships no code path that can spend money.
    throw new Error(`SandboxRenderExecutor.start is implemented in Phase 4 (job ${plan.jobId})`);
  }

  async poll(ref: string): Promise<ExecutorPoll> {
    void parseRef(ref);
    throw new Error("SandboxRenderExecutor.poll is implemented in Phase 4");
  }

  async cancel(ref: string): Promise<void> {
    void parseRef(ref);
    throw new Error("SandboxRenderExecutor.cancel is implemented in Phase 4");
  }
}

export function parseRef(ref: string): SandboxRef {
  const r = JSON.parse(ref) as Partial<SandboxRef>;
  if (typeof r.sandboxId !== "string" || typeof r.cmdId !== "string") throw new Error("bad sandbox ref");
  return { sandboxId: r.sandboxId, cmdId: r.cmdId };
}
