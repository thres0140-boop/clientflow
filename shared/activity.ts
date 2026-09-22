import { prisma } from "@/shared/db/prisma";

export type ActivityType =
  | "script_submitted"
  | "stage_moved"
  | "footage_uploaded"
  | "accepted"
  | "scheduled"
  | "posted"
  | "remixed";

// Fire-and-forget activity logging for the Headquarters digest. Never throws — a failed
// log must never break the action that triggered it.
export async function logActivity(e: {
  clientId?: number | null;
  actor: string;
  type: ActivityType;
  title?: string | null;
  detail?: string | null;
  draftId?: number | null;
}): Promise<void> {
  try {
    await (prisma as any).activityEvent.create({
      data: {
        clientId: e.clientId ?? null,
        actor: e.actor || "System",
        type: e.type,
        title: e.title ?? null,
        detail: e.detail ?? null,
        draftId: e.draftId ?? null,
      },
    });
  } catch {
    /* non-fatal */
  }
}
