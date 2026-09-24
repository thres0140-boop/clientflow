import { NextResponse } from "next/server";
import { aiSchemaReady } from "@/ai/db/ready";
import { prisma } from "@/ai/db/prisma";
import { syncClientPipeline } from "@/ai/features/content/server/syncPipeline";

// Vercel Cron — runs on a schedule (see vercel.json).
// Keeps every connected client's DM pipeline + analytics in sync in the background,
// so detection isn't limited to when someone has a page open.
export async function GET() {
  if (!(await aiSchemaReady())) return NextResponse.json({ ok: true, skipped: "schema_not_applied" }); // AI DB has no schema yet → no-op
  const connections = await prisma.instagramConnection.findMany({
    where: { zernioAccountId: { not: null } },
    select: { clientId: true },
  });

  let created = 0, answered = 0, linked = 0;
  for (const { clientId } of connections) {
    try {
      const r = await syncClientPipeline(clientId);
      created += r.created; answered += r.answered; linked += r.linked;
    } catch (e) {
      console.error(`[cron/sync-pipeline] client ${clientId} error:`, e);
    }
  }

  console.log(`[cron/sync-pipeline] done — ${created} created, ${answered} answered, ${linked} linked`);
  return NextResponse.json({ ok: true, clients: connections.length, created, answered, linked });
}
