import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

// POST { subscription } — store a Web Push subscription, tagged owner vs member so we
// know who to notify. Upsert by endpoint (one row per device/browser).
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { subscription } = await req.json();
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "bad subscription" }, { status: 400 });

  const isOwner = session.type === "owner";
  const data = {
    p256dh, auth,
    subscriberType: isOwner ? "owner" : "member",
    memberId: isOwner ? null : session.memberId,
    clientId: isOwner ? null : (session.clientId ?? null),
  };
  try {
    await (prisma as any).pushSubscription.upsert({ where: { endpoint }, update: data, create: { endpoint, ...data } });
  } catch { return NextResponse.json({ error: "store failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}

// DELETE { endpoint } — remove a subscription (user turned notifications off).
export async function DELETE(req: NextRequest) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await (prisma as any).pushSubscription.delete({ where: { endpoint } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
