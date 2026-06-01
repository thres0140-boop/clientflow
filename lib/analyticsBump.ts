import { prisma } from "@/lib/prisma";

type BumpField = "linksSent" | "bookedCalls" | "messagesSent" | "messagesAnswered";

/**
 * Increment a daily analytics counter by 1 (or n) for a client on a given date.
 * Used by pipeline status transitions + booking webhook to auto-fill the
 * Analytics table. Upserts the day's row so it works even if no row exists yet.
 */
export async function bumpAnalytics(
  clientId: number,
  field: BumpField,
  date: string, // YYYY-MM-DD
  by = 1,
) {
  try {
    await prisma.analyticsEntry.upsert({
      where: { clientId_date: { clientId, date } },
      create: { clientId, date, [field]: by } as any,
      update: { [field]: { increment: by } } as any,
    });
  } catch (e) {
    console.error("[bumpAnalytics] failed:", field, clientId, date, e);
  }
}

export function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
