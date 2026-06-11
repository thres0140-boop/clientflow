"use client";

import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = "BDWsZgwGpPelObrBXr0DHTsJedDU0TdYq5g4Ggt55AwaarLjlXRW7V37_7A6la-L4AYb2xzjI4cir0YaxKj74OY";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Small "Notify me" toggle: registers the SW, asks permission, subscribes, and stores
// the subscription server-side. Hidden when the browser doesn't support push.
export default function PushToggle() {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "blocked" | "working">("off");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      const sub = reg && (await reg.pushManager.getSubscription());
      setState(sub ? "on" : "off");
    }).catch(() => setState("off"));
  }, []);

  async function enable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState(res.ok ? "on" : "off");
    } catch { setState("off"); }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch { /* ignore */ }
    setState("off");
  }

  if (state === "unsupported") return null;
  if (state === "blocked") {
    return <span className="text-[11px] text-slate-400" title="Notifications are blocked in your browser settings">🔕 Notifications blocked</span>;
  }
  const on = state === "on";
  const busy = state === "working";
  return (
    <button
      onClick={on ? disable : enable}
      disabled={busy}
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
        on ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
      } disabled:opacity-50`}
      title={on ? "Notifications on — click to turn off" : "Get notified of new messages"}
    >
      {busy ? "…" : on ? "🔔 Notifications on" : "🔔 Enable notifications"}
    </button>
  );
}
