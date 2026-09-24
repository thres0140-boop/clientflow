import { NextResponse } from "next/server";
import { mirrorTablesExist, pruneMessages, mirrorSizes, RETENTION_MONTHS } from "@/features/instagram/server/inboxMirror";

export const runtime = "nodejs";
export const maxDuration = 120;

// Vercel Cron, monthly: delete mirrored messages older than the retention window (6 months on
// Neon Free). Conversation rows are kept; older messages load live on scroll-up. Idempotent —
// running it twice removes nothing the second time. Logs and returns the count and real sizes.
export async function GET() {
  if (!(await mirrorTablesExist())) return NextResponse.json({ ok: true, skipped: "mirror_not_migrated" });
  const result = await pruneMessages(RETENTION_MONTHS);
  return NextResponse.json({ ok: true, retentionMonths: RETENTION_MONTHS, ...result, sizes: await mirrorSizes() });
}
