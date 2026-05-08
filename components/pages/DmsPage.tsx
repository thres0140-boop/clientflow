"use client";

import { useEffect, useState } from "react";
import { Client, DmLead, DM_STATUSES } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null };

const PIPELINE = DM_STATUSES.filter((s) => s.value !== "no_show");
const STATUS_MAP = Object.fromEntries(DM_STATUSES.map((s) => [s.value, s]));

function statusMeta(status: string) {
  return STATUS_MAP[status] ?? STATUS_MAP["messaged"];
}

const NEXT_STATUS: Record<string, string> = {
  messaged:  "link_sent",
  link_sent: "booked",
  booked:    "showed",
};

export default function DmsPage({ clients, selectedClientId }: Props) {
  const [leads, setLeads]       = useState<DmLead[]>([]);
  const [showAdd, setShowAdd]   = useState(false);
  const [editLead, setEditLead] = useState<DmLead | null>(null);
  const [showNoShow, setShowNoShow] = useState(false);

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

  // Stats
  const total     = leads.length;
  const linkSent  = leads.filter((l) => ["link_sent","booked","showed","no_show"].includes(l.status)).length;
  const booked    = leads.filter((l) => ["booked","showed","no_show"].includes(l.status)).length;
  const showed    = leads.filter((l) => l.status === "showed").length;
  const noShows   = leads.filter((l) => l.status === "no_show");
  const convRate  = total  > 0 ? Math.round((showed / total) * 100) : null;
  const bookRate  = linkSent > 0 ? Math.round((booked / linkSent) * 100) : null;
  const showRate  = booked > 0 ? Math.round((showed / booked) * 100) : null;

  const leadsBy = (status: string) => leads.filter((l) => l.status === status);

  if (!selectedClientId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Select a client to view DMs
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">DM Pipeline</h1>
          <p className="text-slate-500 mt-0.5 text-sm">
            {client ? `${client.name} · ` : ""}Track leads from first message to booked call
          </p>
        </div>
        <button
          onClick={() => { setEditLead(null); setShowAdd(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + Add Lead
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Leads",    value: total,    sub: null },
          { label: "Link Sent",      value: linkSent, sub: bookRate !== null ? `${bookRate}% booked` : null },
          { label: "Booked",         value: booked,   sub: showRate !== null ? `${showRate}% showed` : null },
          { label: "Showed",         value: showed,   sub: convRate !== null ? `${convRate}% overall` : null },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Pipeline kanban */}
      <div className="grid grid-cols-4 gap-4">
        {PIPELINE.map((stage) => {
          const stageLeads = leadsBy(stage.value);
          return (
            <div key={stage.value} className="space-y-2">
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${stage.bg} ${stage.border} border`}>
                <span className={`text-xs font-semibold ${stage.text}`}>{stage.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/70 ${stage.text}`}>{stageLeads.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[120px]">
                {stageLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onEdit={() => { setEditLead(lead); setShowAdd(true); }}
                    onDelete={() => deleteLead(lead.id)}
                    onMove={NEXT_STATUS[lead.status] ? () => moveStatus(lead, NEXT_STATUS[lead.status]) : undefined}
                    onNoShow={lead.status === "booked" ? () => moveStatus(lead, "no_show") : undefined}
                  />
                ))}
                {stageLeads.length === 0 && (
                  <div className="border-2 border-dashed border-slate-100 rounded-xl h-20 flex items-center justify-center text-xs text-slate-300">
                    Empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* No Shows section */}
      {noShows.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowNoShow((v) => !v)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600"
          >
            <span>{showNoShow ? "▼" : "▶"}</span>
            <span>No Shows ({noShows.length})</span>
          </button>
          {showNoShow && (
            <div className="grid grid-cols-4 gap-3">
              {noShows.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onEdit={() => { setEditLead(lead); setShowAdd(true); }}
                  onDelete={() => deleteLead(lead.id)}
                  onMove={() => moveStatus(lead, "booked")}
                  moveLabel="↩ Rebook"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit modal */}
      {showAdd && (
        <LeadModal
          clients={clients}
          selectedClientId={selectedClientId}
          lead={editLead}
          onClose={() => { setShowAdd(false); setEditLead(null); }}
          onSaved={() => { setShowAdd(false); setEditLead(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Lead card ─────────────────────────────────────────────────────────────────
function LeadCard({
  lead, onEdit, onDelete, onMove, onNoShow, moveLabel,
}: {
  lead: DmLead;
  onEdit: () => void;
  onDelete: () => void;
  onMove?: () => void;
  onNoShow?: () => void;
  moveLabel?: string;
}) {
  const meta = statusMeta(lead.status);
  const nextMeta = NEXT_STATUS[lead.status] ? statusMeta(NEXT_STATUS[lead.status]) : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{lead.name}</p>
          {lead.handle && (
            <p className="text-xs text-slate-400 truncate">@{lead.handle.replace(/^@/, "")}</p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onEdit} className="p-1 text-slate-400 hover:text-slate-600 rounded">✏️</button>
          <button onClick={onDelete} className="p-1 text-slate-400 hover:text-red-500 rounded">✕</button>
        </div>
      </div>

      {lead.notes && (
        <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{lead.notes}</p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
        {onMove && nextMeta && (
          <button
            onClick={onMove}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${nextMeta.bg} ${nextMeta.text} ${nextMeta.border} hover:opacity-80`}
          >
            {moveLabel ?? `→ ${nextMeta.label}`}
          </button>
        )}
        {onNoShow && (
          <button
            onClick={onNoShow}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold border bg-red-50 text-red-600 border-red-200 hover:opacity-80"
          >
            No Show
          </button>
        )}
        {!onMove && !onNoShow && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.bg} ${meta.text}`}>
            {moveLabel ?? meta.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function LeadModal({
  clients, selectedClientId, lead, onClose, onSaved,
}: {
  clients: Client[];
  selectedClientId: number | null;
  lead: DmLead | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name:   lead?.name   ?? "",
    handle: lead?.handle ?? "",
    status: lead?.status ?? "messaged",
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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Instagram handle</label>
              <input value={form.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@handle"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <div className="flex flex-wrap gap-2">
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
              {lead ? "Save Changes" : "Add Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
