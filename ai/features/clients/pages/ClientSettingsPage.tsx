"use client";
import { AI_API } from "@/ai/slug";
import { useEffect, useState } from "react";
import { Client } from "@/ai/shared/types";

type Props = {
  client: Client | null;
  refreshClients: () => void;
  onManageAll: () => void;
};

const COLORS = ["#3d4aa3", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#06b6d4", "#64748b"];

// Per-client settings — the settings of the CURRENTLY selected client (not the global list).
export default function ClientSettingsPage({ client, refreshClients, onManageAll }: Props) {
  const [form, setForm] = useState({
    name: "", color: "#3d4aa3", language: "nl",
    generationInterval: 2, scriptAlternatives: 5,
    captionStyle: "", captionGuidelines: "", scriptRules: "",
    bookingLink: "", ctaKeyword: "", instagramEnabled: true, tiktokEnabled: true, tiktokHandle: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!client) return;
    setForm({
      name: client.name || "",
      color: client.color || "#3d4aa3",
      language: client.language || "nl",
      generationInterval: client.generationInterval ?? 2,
      scriptAlternatives: client.scriptAlternatives ?? 5,
      captionStyle: client.captionStyle || "",
      captionGuidelines: client.captionGuidelines || "",
      scriptRules: client.scriptRules || "",
      bookingLink: client.bookingLink || "",
      ctaKeyword: client.ctaKeyword || "",
      instagramEnabled: (client as any).instagramEnabled !== false, // default on // eslint-disable-line @typescript-eslint/no-explicit-any
      tiktokEnabled: true, // AI product: always on // eslint-disable-line @typescript-eslint/no-explicit-any
      tiktokHandle: (client as any).tiktokHandle || "", // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    setSaved(false);
  }, [client]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); }

  async function save() {
    if (!client) return;
    setSaving(true);
    try {
      await fetch(`${AI_API}/clients/${client.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await refreshClients();
      setSaved(true);
    } finally { setSaving(false); }
  }

  if (!client) {
    return <div className="flex items-center justify-center h-[60vh] text-faint text-sm">Select a client to open their settings.</div>;
  }

  const initials = client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: form.color }}>{initials}</div>
          <div>
            <h1 className="text-xl font-semibold text-ink">{client.name}</h1>
            <p className="text-faint text-sm">Settings</p>
          </div>
        </div>
        <button onClick={onManageAll} className="text-xs font-medium text-accent hover:text-accent-strong">Manage all clients →</button>
      </div>

      <div className="space-y-4">
        {/* General */}
        <Card title="General">
          <Field label="Name">
            <input value={form.name} onChange={(e) => set("name", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => set("color", c)}
                  className="w-7 h-7 rounded-lg transition-transform hover:scale-110"
                  style={{ backgroundColor: c, boxShadow: form.color === c ? "0 0 0 2px white, 0 0 0 4px " + c : "none" }} />
              ))}
            </div>
          </Field>
          <Field label="Language">
            <select value={form.language} onChange={(e) => set("language", e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent/40">
              <option value="nl">Dutch</option>
              <option value="en">English</option>
            </select>
          </Field>
        </Card>

        {/* Platforms */}
        <Card title="Platforms" subtitle="Which channels this client is active on (at least one must stay on).">
          <Toggle label="📸 Instagram" desc="Instagram pipeline, competitors & DMs." checked={form.instagramEnabled}
            onChange={(v) => { if (!v && !form.tiktokEnabled) { alert("Enable TikTok first — a client must have at least one platform on."); return; } set("instagramEnabled", v); }} />
          <p className="text-xs text-muted">🎵 TikTok is always on for AI clients.</p>
          {form.tiktokEnabled && (
            <div className="rounded-lg bg-surface-2 border border-line px-3 py-2.5">
              {(client as any)?.tiktokZernioUsername ? ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <p className="text-xs text-ink-2"><span className="font-semibold text-ok-700">✓ Connected via Zernio</span> · @{(client as any).tiktokZernioUsername}</p>
              ) : (
                <p className="text-xs text-muted">Connect this client&apos;s TikTok on the <span className="font-semibold text-ink-2">TikTok → Profile</span> tab (one-click, via Zernio) to pull analytics.</p>
              )}
            </div>
          )}
        </Card>

        {/* Content generation */}
        <Card title="Content generation">
          <Field label="Scripts generated per batch">
            <input type="number" min={1} max={20} value={form.scriptAlternatives} onChange={(e) => set("scriptAlternatives", parseInt(e.target.value) || 1)}
              className="w-28 border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
          <Field label="Weeks between generations">
            <input type="number" min={1} max={12} value={form.generationInterval} onChange={(e) => set("generationInterval", parseInt(e.target.value) || 1)}
              className="w-28 border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
        </Card>

        {/* Captions & scripts */}
        <Card title="Captions & scripts">
          <Field label="Caption style">
            <input value={form.captionStyle} onChange={(e) => set("captionStyle", e.target.value)} placeholder="e.g. short, punchy, 1 emoji max"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
          <Field label="Caption guidelines">
            <textarea rows={3} value={form.captionGuidelines} onChange={(e) => set("captionGuidelines", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
          <Field label="Script rules">
            <textarea rows={3} value={form.scriptRules} onChange={(e) => set("scriptRules", e.target.value)} placeholder="Tone, do's & don'ts the AI must follow…"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
        </Card>

        {/* Booking & CTA */}
        <Card title="Booking & CTA">
          <Field label="Booking link">
            <input value={form.bookingLink} onChange={(e) => set("bookingLink", e.target.value)} placeholder="https://cal.com/…"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
          <Field label="CTA keyword" hint="Inbound DMs containing this word get flagged as leads.">
            <input value={form.ctaKeyword} onChange={(e) => set("ctaKeyword", e.target.value)} placeholder="e.g. regie"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </Field>
        </Card>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 right-0 left-0 md:left-auto md:right-8 md:bottom-6 flex justify-end p-4 md:p-0 pointer-events-none">
        <button onClick={save} disabled={saving}
          className="pointer-events-auto o-btn o-btn-accent o-elev-lift disabled:opacity-60">
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="o-card p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-[11px] text-faint mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-2 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-faint mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, desc, checked, disabled, onChange }: { label: string; desc?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-1 ${disabled ? "opacity-70" : ""}`}>
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {desc && <p className="text-[11px] text-faint">{desc}</p>}
      </div>
      <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${checked ? "bg-accent" : "bg-surface-5"} ${disabled ? "cursor-not-allowed" : ""}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
