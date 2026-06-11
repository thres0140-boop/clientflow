import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// VAPID public key is safe to ship to the browser; the private key is server-only (env).
export const VAPID_PUBLIC_KEY = "BDWsZgwGpPelObrBXr0DHTsJedDU0TdYq5g4Ggt55AwaarLjlXRW7V37_7A6la-L4AYb2xzjI4cir0YaxKj74OY";
const VAPID_SUBJECT = "mailto:cenk@onlinepersonaltrainer.co";

let configured = false;
function ensure(): boolean {
  if (configured) return true;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return false;
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, priv); configured = true; return true; }
  catch { return false; }
}

type PushPayload = { title: string; body: string; url?: string };

// Send a notification to a set of stored subscriptions. Dead subscriptions (404/410)
// are pruned. Never throws — push is best-effort.
export async function sendPush(
  where: { subscriberType: "owner" } | { subscriberType: "member"; clientId: number },
  payload: PushPayload,
): Promise<void> {
  if (!ensure()) return;
  let subs: { id: number; endpoint: string; p256dh: string; auth: string }[] = [];
  try {
    subs = await (prisma as any).pushSubscription.findMany({ where });
  } catch { return; }
  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json);
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        await (prisma as any).pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }));
}
