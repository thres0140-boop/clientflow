"use client";
import { useEffect, useState } from "react";
import { Client } from "@/lib/types";

// TikTok "Instructions" — the per-client, views-maximizing playbook. Reads the client's TikTok
// performance + competitor breakouts and routes concepts into keep / test / copy / stop, each
// denominated in Expected Views. TikTok-only; never touches Instagram.

type Rec = { id: string; title: string; ev: number; evidence: string; action: string; meta?: Record<string, unknown> };
type Data = {
  connected: boolean; summary?: string; note?: string;
  stats?: { totalVideos: number; accountMedianViews: number; conceptsTracked: number; competitorsScanned: number; breakoutsFound: number };
  keep: Rec[]; test: Rec[]; copy: Rec[]; stop: Rec[]; generatedAt?: string; cached?: boolean;
};

function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1_000) return Math.round(n / 1_000) + "K";
  return String(Math.round(n));
}
function ago(iso?: string): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
// Minimal **bold** renderer.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={i} className="text-ink">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)}</>;
}

const BUCKETS = [
  { key: "keep" as const, icon: "✅", title: "Keep posting", tint: "bg-green-50 border-green-200", head: "text-green-800", desc: "Highest expected-views concepts — exploit these." },
  { key: "test" as const, icon: "🧪", title: "Test next", tint: "bg-blue-50 border-blue-200", head: "text-blue-800", desc: "High upside, under-explored — explore for new winners." },
  { key: "copy" as const, icon: "🎯", title: "Copy from competitors", tint: "bg-purple-50 border-purple-200", head: "text-purple-800", desc: "Breakout videos — new arms to add to your rotation." },
  { key: "stop" as const, icon: "🛑", title: "Stop / rework", tint: "bg-amber-50 border-amber-200", head: "text-amber-800", desc: "Below baseline — every slot here is views lost elsewhere." },
];

export default function TikTokInstructionsPage({ clients, selectedClientId }: { clients: Client[]; selectedClientId: number | null }) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  async function load(refresh = false) {
    if (!client) return;
    refresh ? setRegenerating(true) : setLoading(true);
    try {
      const d = await fetch(`/api/tiktok/instructions?clientId=${client.id}${refresh ? "&refresh=1" : ""}`).then((r) => r.json());
      setData(d);
    } catch { setData(null); }
    setLoading(false); setRegenerating(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client?.id]);

  if (!client) return <div className="flex items-center justify-center h-64 text-faint text-sm">Select a client to view their TikTok instructions</div>;

  const s = data?.stats;
  const empty = data && (!data.connected || data.note);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Instructions</h1>
          <p className="text-sm text-muted">AI playbook for {client.name} — maximize views: what to keep, test, copy, and cut.</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generatedAt && <span className="text-[11px] text-faint">Updated {ago(data.generatedAt)}</span>}
          <button onClick={() => load(true)} disabled={regenerating || loading}
            className="px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {regenerating ? "Regenerating…" : "↻ Regenerate"}
          </button>
        </div>
      </div>

      {loading && !data && <div className="flex items-center justify-center h-40 text-faint text-sm">Building the playbook…</div>}

      {empty && (
        <div className="bg-white rounded-2xl border border-line p-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-black flex items-center justify-center text-2xl o-elev-lift mb-3">🧭</div>
          <h2 className="text-base font-bold text-ink mb-1">{data?.connected ? "Almost there" : "Connect TikTok first"}</h2>
          <p className="text-sm text-muted max-w-md mx-auto">{data?.note}</p>
          <p className="text-xs text-faint mt-3">Tag videos with concepts in the Analytics table and add TikTok competitors — the playbook sharpens with both.</p>
        </div>
      )}

      {data && !empty && (
        <>
          {/* Summary + stats */}
          {data.summary && (
            <div className="bg-white rounded-2xl border border-line p-4 text-sm text-ink-2 leading-relaxed"><Rich text={data.summary} /></div>
          )}
          {s && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {[["Videos analyzed", s.totalVideos], ["Your median", fmt(s.accountMedianViews) + " views"], ["Concepts tracked", s.conceptsTracked], ["Competitors scanned", s.competitorsScanned], ["Breakouts found", s.breakoutsFound]].map(([l, v]) => (
                <span key={String(l)} className="bg-slate-100 rounded-full px-2.5 py-1 text-muted"><span className="font-semibold text-ink-2">{v}</span> {l}</span>
              ))}
            </div>
          )}

          {/* Buckets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {BUCKETS.map((b) => {
              const items = (data[b.key] || []);
              return (
                <div key={b.key} className={`rounded-2xl border p-4 ${b.tint}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-lg">{b.icon}</span>
                    <h2 className={`text-sm font-bold ${b.head}`}>{b.title}</h2>
                    <span className="ml-auto text-[11px] font-semibold text-ink-2/60 bg-white/70 rounded-full px-2 py-0.5">{items.length}</span>
                  </div>
                  <p className="text-[11px] text-ink-2/60 mb-2.5">{b.desc}</p>
                  <div className="space-y-2">
                    {items.length === 0 && <p className="text-xs text-ink-2/50 italic py-2">Nothing here yet — tag more videos / add competitors.</p>}
                    {items.map((r) => {
                      const link = (r.meta?.permalink as string) || undefined;
                      const Wrapper: any = link ? "a" : "div"; // eslint-disable-line @typescript-eslint/no-explicit-any
                      return (
                        <Wrapper key={r.id} {...(link ? { href: link, target: "_blank", rel: "noreferrer" } : {})}
                          className={`block bg-white/80 border border-white rounded-xl px-3 py-2.5 ${link ? "hover:border-accent hover:bg-white transition-colors" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-ink truncate">{r.title}</p>
                            <span className="text-[11px] font-bold text-accent-strong whitespace-nowrap">~{fmt(r.ev)} views{b.key === "copy" ? " potential" : "/post"}</span>
                          </div>
                          <p className="text-[11px] text-ink-2/70 mt-0.5">{r.evidence}</p>
                          <p className="text-[11px] text-ink-2 mt-1">→ {r.action}</p>
                        </Wrapper>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-faint">Everything is ranked by <b>Expected Views per Post</b>. Small-sample concepts are shrunk toward your account median (no chasing flukes); competitor breakouts are filtered for bought views and require beating the competitor&apos;s own baseline. TikTok-only.</p>
        </>
      )}
    </div>
  );
}
