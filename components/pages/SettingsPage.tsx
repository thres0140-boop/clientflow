"use client";

import { useState } from "react";
import { Client, PLATFORMS } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import ClientAvatar from "@/components/ui/ClientAvatar";

type Props = {
  clients: Client[];
  refreshClients: () => void;
  onNavigateToPipeline: (clientId: number) => void;
};

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#06b6d4", "#64748b", "#1e293b",
];

export default function SettingsPage({ clients, refreshClients, onNavigateToPipeline }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  async function deleteClient(id: number) {
    if (!confirm("Delete this client? All their content and concepts will also be deleted.")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    refreshClients();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 mt-1 text-sm">Manage your clients and workspace</p>
      </div>

      {/* Clients section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-700">Clients</h2>
            <p className="text-xs text-slate-400 mt-0.5">{clients.length} client{clients.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + Add Client
          </button>
        </div>

        {clients.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="text-4xl mb-3">👥</div>
            <p className="text-slate-500 text-sm">No clients yet. Add your first client to get started.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {clients.map((client, i) => (
              <div
                key={client.id}
                className={`flex items-center gap-4 px-5 py-4 ${i !== clients.length - 1 ? "border-b border-slate-100" : ""}`}
              >
                <ClientAvatar name={client.name} color={client.color} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{client.name}</p>
                  <p className="text-xs text-slate-400 capitalize">{client.platform}</p>
                </div>
                {client.notes && (
                  <p className="text-xs text-slate-400 max-w-xs truncate hidden lg:block">{client.notes}</p>
                )}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onNavigateToPipeline(client.id)}
                    className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"
                  >
                    View Pipeline
                  </button>
                  <button
                    onClick={() => setEditing(client)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteClient(client.id)}
                    className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <ClientModal
          onClose={() => { setShowAdd(false); refreshClients(); }}
          onSaved={() => refreshClients()}
        />
      )}
      {editing && (
        <ClientModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshClients(); }}
        />
      )}
    </div>
  );
}

function ClientModal({
  client, onClose, onSaved,
}: {
  client?: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<"details" | "connect">("details");
  const [newClientId, setNewClientId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: client?.name ?? "",
    platform: client?.platform ?? "instagram",
    profileUrl: client?.profileUrl ?? "",
    color: client?.color ?? "#6366f1",
    notes: client?.notes ?? "",
    captionStyle: client?.captionStyle ?? "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const method = client ? "PUT" : "POST";
    const url = client ? `/api/clients/${client.id}` : "/api/clients";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!client) {
      const data = await res.json();
      setNewClientId(data.id);
      onSaved();
      setStep("connect");
    } else {
      onSaved();
      onClose();
    }
  }

  // Step 2: connect Instagram after creating client
  if (step === "connect" && newClientId) {
    return (
      <Modal title="Connect Instagram" onClose={onClose}>
        <div className="flex flex-col items-center text-center gap-5 py-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-2xl shadow-lg">
            📸
          </div>
          <div>
            <p className="text-base font-bold text-slate-800 mb-1">{form.name} added!</p>
            <p className="text-sm text-slate-500 max-w-xs">
              Connect their Instagram Business account to pull in real reels and analytics.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <a
              href={`/api/auth/instagram?clientId=${newClientId}`}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity shadow"
            >
              Connect Instagram via Meta
            </a>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-sm text-slate-500 hover:text-slate-700"
            >
              Skip for now
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Adding a new client — just name + color
  if (!client) {
    return (
      <Modal title="Add Client" onClose={onClose}>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client name *</label>
            <input
              required
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Brand color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set("color", c)}
                  className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {form.name && (
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <ClientAvatar name={form.name} color={form.color} size="md" />
              <p className="text-sm font-semibold text-slate-800">{form.name}</p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Add Client →
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  // Editing existing client — full settings
  return (
    <Modal title="Edit Client" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Primary Platform</label>
          <select value={form.platform} onChange={(e) => set("platform", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Profile URL</label>
          <input type="url" value={form.profileUrl} onChange={(e) => set("profileUrl", e.target.value)}
            placeholder="https://instagram.com/..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Brand Color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set("color", c)}
                className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Caption Style / Voice Training ✨</label>
          <p className="text-[10px] text-slate-400 mb-1.5">Paste example captions or describe the tone.</p>
          <textarea rows={4} value={form.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}
            placeholder={"Example captions:\n\n\"Living proof that hard work pays off 💪 #fitness\"\n\nTone: casual, motivational, uses emojis."}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}
