import { prisma } from "@/shared/db/prisma";
import { sendWhatsApp } from "@/shared/notify/notify";

// ─────────────────────────────────────────────────────────────────────────────
// Instagram Inbox mirror — health and alerting.
//
// The mirror went stale for three days (24–27 Sep 2026) without anyone noticing: every cron was
// 308-redirected by the canonical-host rule and the inbox webhook was never live, so nothing
// wrote to it and nothing complained. This module makes that loud.
//
// Lag per client = now − the newest sync activity in ZernioSyncState (a reconcile, a full walk,
// or any backfill page, which bumps updatedAt). Past MIRROR_ALERT_HOURS the owner gets a
// WhatsApp + email, at most once per ALERT_REPEAT_HOURS. The check runs from the hourly
// inbox-health cron AND after every Instagram Inbox load, so it still fires if crons die again.
// ─────────────────────────────────────────────────────────────────────────────

export const MIRROR_ALERT_HOURS = Number(process.env.MIRROR_ALERT_HOURS) || 2;
const ALERT_REPEAT_HOURS = 6;
const ALERT_KEY = "inbox-mirror-stale";

export type ClientLag = { clientId: number; phase: string | null; lastSyncAt: string | null; lagHours: number | null; behind: boolean };
export type MirrorHealth = { ok: boolean; thresholdHours: number; worstLagHours: number | null; clients: ClientLag[] };

const hoursSince = (d: Date) => (Date.now() - d.getTime()) / 3_600_000;
const newest = (...ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

export async function mirrorHealth(): Promise<MirrorHealth> {
  const [conns, states] = await Promise.all([
    prisma.instagramConnection.findMany({ where: { zernioAccountId: { not: null } }, select: { clientId: true } }),
    prisma.zernioSyncState.findMany(),
  ]);
  const byClient = new Map(states.map((s) => [s.clientId, s]));
  const clients: ClientLag[] = conns.map(({ clientId }) => {
    const s = byClient.get(clientId);
    const last = newest(s?.lastReconcileAt, s?.lastFullSyncAt, s?.updatedAt);
    const lagHours = last ? Math.round(hoursSince(last) * 10) / 10 : null;
    return { clientId, phase: s?.phase ?? null, lastSyncAt: last?.toISOString() ?? null, lagHours, behind: lagHours === null || lagHours > MIRROR_ALERT_HOURS };
  });
  const lags = clients.map((c) => c.lagHours ?? Infinity);
  const worst = lags.length ? Math.max(...lags) : null;
  return { ok: clients.every((c) => !c.behind), thresholdHours: MIRROR_ALERT_HOURS, worstLagHours: worst === Infinity ? null : worst, clients };
}

// Claims the alert slot atomically (one row per alert key), so parallel checks send one alert.
async function claimAlertSlot(): Promise<boolean> {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MonitorAlert" ("key" TEXT PRIMARY KEY, "sentAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `INSERT INTO "MonitorAlert" ("key", "sentAt") VALUES ($1, now())
     ON CONFLICT ("key") DO UPDATE SET "sentAt" = now() WHERE "MonitorAlert"."sentAt" < now() - make_interval(hours => $2)
     RETURNING "key"`, ALERT_KEY, ALERT_REPEAT_HOURS);
  return rows.length > 0;
}

async function sendEmail(subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY, to = process.env.OWNER_EMAIL;
  if (!key || !to) return;
  const from = `${process.env.RESEND_FROM_NAME || "ORDO"} <${process.env.RESEND_FROM_EMAIL || "noreply@ordoagency.com"}>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) console.error("[mirror-health] email failed", res.status, await res.text().catch(() => ""));
  } catch (e) { console.error("[mirror-health] email failed", e instanceof Error ? e.message : e); }
}

// Check and, when behind, alert the owner (rate-limited). Never throws.
export async function checkMirrorAndAlert(source: string): Promise<MirrorHealth | null> {
  try {
    const h = await mirrorHealth();
    if (h.ok) return h;
    console.error(`[mirror-health] BEHIND (via ${source}): worst ${h.worstLagHours ?? "never synced"}h, threshold ${h.thresholdHours}h`, JSON.stringify(h.clients.filter((c) => c.behind)));
    if (!(await claimAlertSlot())) return h;
    const lines = h.clients.filter((c) => c.behind).map((c) => `client ${c.clientId}: ${c.lagHours === null ? "never synced" : `${c.lagHours}h behind`} (${c.phase ?? "no state"})`);
    const text = `Ordo Instagram Inbox mirror is more than ${h.thresholdHours}h behind.\n${lines.join("\n")}\nCenks Dashboard DM Inbox and Ordo's unread badges are stale. Check the inbox-reconcile cron in Vercel logs (clientflow, /api/cron/inbox-reconcile) and GET https://www.ordoagency.com/api/cron/inbox-health.`;
    await Promise.all([sendWhatsApp(text), sendEmail(`⚠️ Ordo inbox mirror ${h.worstLagHours ?? "∞"}h behind`, text)]);
    return h;
  } catch (e) {
    console.error("[mirror-health] check failed", e instanceof Error ? e.message : e);
    return null;
  }
}
