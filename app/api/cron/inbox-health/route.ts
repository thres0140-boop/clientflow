import { NextResponse } from "next/server";
import { checkMirrorAndAlert } from "@/features/instagram/server/mirrorHealth";

export const runtime = "nodejs";

// Vercel Cron, hourly: is the Instagram Inbox mirror keeping up? Alerts the owner (WhatsApp +
// email, rate-limited) when any client is more than MIRROR_ALERT_HOURS behind. Answers 503 while
// behind so an external uptime monitor can watch this URL too.
export async function GET() {
  const h = await checkMirrorAndAlert("cron");
  if (!h) return NextResponse.json({ ok: false, error: "check_failed" }, { status: 500 });
  return NextResponse.json(h, { status: h.ok ? 200 : 503 });
}
