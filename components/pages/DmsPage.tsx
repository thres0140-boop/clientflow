"use client";

import { useEffect, useState } from "react";
import { Client, DmLead, DM_STATUSES } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null };
type Period = "week" | "2weeks" | "month" | "all";

// ── Date helpers (same as Analytics) ──────────────────────────────────────────
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getMonday(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function periodDays(p: Period): number {
  return p === "week" ? 7 : p === "2weeks" ? 14 : p === "month" ? 28 : Infinity;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function rangeLabel(start: Date, count: number): string {
  if (!isFinite(count)) return "All time";
  const end = addDays(start, count - 1);
  const sm = MONTHS[start.getMonth()], em = MONTHS[end.getMonth()];
  return start.getMonth() === end.getMonth()
    ? `${sm} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
    : `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
}

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_MAP = Object.fromEntries(DM_STATUSES.map((s) => [s.value, s]));
function statusMeta(status: string) { return STATUS_MAP[status] ?? STATUS_MAP["messaged"]; }

// Pipeline columns (all 6 visible)
const PIPELINE_COLS = DM_STATUSES.map((s) => s.value);

// One-click next stage
const NEXT: Record<string, string> = {
  messaged:  "link_sent",
  link_sent: "booked",
  booked:    "showed",
  showed:    "closed",
};

export default function DmsPage({ clients, selectedClientId }: Props) {
  const [leads, setLeads]     = useState<DmLead[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editLead, setEditLead] = useState<DmLead | null>(null);

  // Date range controls (same pattern as Analytics)
  const [period, setPeriod]       = useState<Period>("week");
  const [startDate, setStartDate] = useState<Date>(() => getMonday(new Date()));

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  useEffect(() => { load(); }, [selectedClientId]);

  async function load() {
    if (!selectedClientId) return;
    const data = await fetch(`/api/dm-leads?clientId=${selectedClientId}`).then((r) => r.json());
    setLeads(Array.isArray(data) ? data : []);
  }

  async function moveStatus(lead: DmLead, status: string) {
    await fetch(`/api/dm-leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function deleteLead(id: number) {
    if (!confirm("Remove this lead?")) return;
    await fetch(`/api/dm-leads/${id}`, { method: "DELETE" });
    load();
  }

  // Filter by date range
  const days = periodDays(period);
  const from = period !== "all" ? toYMD(startDate) : null;
  const to   = period !== "all" ? toYMD(addDays(startDate, days - 1)) : null;

  const filtered = leads.filter((l) => {
    if (period === "all") return true;
    if (!l.date) return false; // leads without a date are excluded from date-filtered views
    return l.date >= from! && l.date <= to!;
  });

  // Stats (over filtered leads)
  const total    = filtered.length;
  const linkSent = filtered.filter((l) => ["link_sent","booked","showed","no_show","closed"].includes(l.status)).length;
  const booked   = filtered.filter((l) => ["booked","showed","no_show","closed"].includes(l.status)).length;
  const showed   = filtered.filter((l) => ["showed","closed"].includes(l.status)).length;
  const closed   = filtered.filter((l) => l.status === "closed").length;

  const pct = (a: number, b: number) => b > 0 ? `${Math.round((a / b) * 100)}%` : null;

  const leadsBy = (status: string) => filtered.filter((l) => l.status === status);

  if (!selectedClientId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Select a client to view DM pipeline
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">DM Pipeline</h1>
          <p className="text-slate-500 mt-0.5 text-sm">
            {client?.name} · Manual tracking — add leads as you message them on Instagram
          </p>
        </div>
        <button
          onClick={() => { setEditLead(null); setShowAdd(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + Add Lead
        </button>
      </div>

      {/* Date range controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Period selector */}
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(["week","2weeks","month","all"] as Period[]).map((p) => (
            <button key={p} onClick={() => { setPeriod(p); if (p !== "all") setStartDate(getMonday(new Date())); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {p === "week" ? "1 Week" : p === "2weeks" ? "2 Weeks" : p === "month" ? "Month" : "All time"}
            </button>
          ))}
        </div>

        {period !== "all" && (
          <>
            <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setStartDate((d) => addDays(d, -days))} className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-r border-slate-200">‹</button>
              <span className="px-4 text-sm font-medium text-slate-700 whitespace-nowrap">{rangeLabel(startDate, days)}</span>
              <button onClick={() => setStartDate((d) => addDays(d, days))}  className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-l border-slate-200">›</button>
            </div>
            <button onClick={() => setStartDate(getMonday(new Date()))}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 bg-white">
              Now
            </button>
          </>
        )}

        <span className="ml-2 text-xs text-slate-400">
          {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
          {period !== "all" && leads.length !== filtered.length ? ` of ${leads.length} total` : ""}
        </span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Messaged",   value: total,    sub: null },
          { label: "Link Sent",  value: linkSent, sub: pct(linkSent, total) },
          { label: "Booked",     value: booked,   sub: pct(booked, linkSent) ? `${pct(booked, linkSent)} of links` : null },
          { label: "Showed",     value: showed,   sub: pct(showed, booked) ? `${pct(showed, booked)} of booked` : null },
          { label: "Closed",     value: closed,   sub: pct(closed, total) ? `${pct(closed, total)} conv. rate` : null },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3.5">
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className="text-2xl font-bold text-slate-800 mt-0.5">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Kanban — 6 columns */}
      <div className="grid grid-cols-6 gap-3">
        {PIPELINE_COLS.map((statusVal) => {
          const meta   = statusMeta(statusVal);
          const col    = leadsBy(statusVal);
          const nextSt = NEXT[statusVal];

          return (
            <div key={statusVal} className="flex flex-col gap-2">
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${meta.bg} ${meta.border}`}>
                <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/70 ${meta.text}`}>{col.length}</span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 min-h-[100px]">
                {col.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onEdit={() => { setEditLead(lead); setShowAdd(true); }}
                    onDelete={() => deleteLead(lead.id)}
                    onNext={nextSt ? () => moveStatus(lead, nextSt) : undefined}
                    onNoShow={statusVal === "booked" ? () => moveStatus(lead, "no_show") : undefined}
                    onRebook={statusVal === "no_show" ? () => moveStatus(lead, "booked") : undefined}
                  />
                ))}
                {col.length === 0 && (
                  <div className="border-2 border-dashed border-slate-100 rounded-xl h-16 flex items-center justify-center text-xs text-slate-300">
                    —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <LeadModal
          selectedClientId={selectedClientId}
          lead={editLead}
          onClose={() => { setShowAdd(false); setEditLead(null); }}
          onSaved={() => { setShowAdd(false); setEditLead(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Lead card ──────────────────────────────────────────────────────────────────
function LeadCard({
  lead, onEdit, onDelete, onNext, onNoShow, onRebook,
}: {
  lead: DmLead;
  onEdit: () => void;
  onDelete: () => void;
  onNext?: () => void;
  onNoShow?: () => void;
  onRebook?: () => void;
}) {
  const nextMeta = onNext ? statusMeta(Object.entries({
    messaged:"link_sent", link_sent:"booked", booked:"showed", showed:"closed"
  }).find(([k]) => k === lead.status)?.[1] ?? "") : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow group text-left">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800 truncate leading-tight">{lead.name}</p>
          {lead.handle && (
            <p className="text-[10px] text-slate-400 truncate">@{lead.handle.replace(/^@/, "")}</p>
          )}
          {lead.date && (
            <p className="text-[10px] text-slate-300 mt-0.5">{lead.date.slice(5).replace("-", "/")}</p>
          )}
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onEdit}   className="p-0.5 text-slate-300 hover:text-slate-600 rounded text-xs">✏️</button>
          <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded text-xs">✕</button>
        </div>
      </div>

      {lead.notes && (
        <p className="text-[10px] text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">{lead.notes}</p>
      )}

      {/* Action buttons */}
      <div className="mt-2 flex flex-col gap-1">
        {onNext && nextMeta && (
          <button onClick={onNext}
            className={`w-full px-2 py-1 rounded-lg text-[10px] font-semibold border text-center ${nextMeta.bg} ${nextMeta.text} ${nextMeta.border} hover:opacity-80`}>
            → {nextMeta.label}
          </button>
        )}
        {onNoShow && (
          <button onClick={onNoShow}
            className="w-full px-2 py-1 rounded-lg text-[10px] font-semibold border text-center bg-red-50 text-red-600 border-red-200 hover:opacity-80">
            No Show
          </button>
        )}
        {onRebook && (
          <button onClick={onRebook}
            className="w-full px-2 py-1 rounded-lg text-[10px] font-semibold border text-center bg-blue-50 text-blue-600 border-blue-200 hover:opacity-80">
            ↩ Rebook
          </button>
        )}
      </div>
    </div>
  );
}

// ── Add / Edit modal ───────────────────────────────────────────────────────────
function LeadModal({
  selectedClientId, lead, onClose, onSaved,
}: {
  selectedClientId: number | null;
  lead: DmLead | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  const [form, setForm] = useState({
    name:   lead?.name   ?? "",
    handle: lead?.handle ?? "",
    status: lead?.status ?? "messaged",
    date:   lead?.date   ?? todayYMD(),
    notes:  lead?.notes  ?? "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lead) {
      await fetch(`/api/dm-leads/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/dm-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, clientId: selectedClientId }),
      });
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{lead ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Instagram</label>
              <input value={form.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@handle"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date messaged</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {DM_STATUSES.map((s) => (
                <button key={s.value} type="button" onClick={() => set("status", s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    form.status === s.value ? `${s.bg} ${s.text} ${s.border}` : "bg-white text-slate-400 border-slate-200"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              {lead ? "Save" : "Add Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
