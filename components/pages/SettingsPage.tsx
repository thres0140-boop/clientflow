"use client";

import { useState, useEffect } from "react";
import { Client, PLATFORMS } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import ClientAvatar from "@/components/ui/ClientAvatar";

// ─── Connection status badge ──────────────────────────────────────────────────
function ConnBadge({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  const color = ok ? "bg-green-100 text-green-700" : warn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400";
  const dot   = ok ? "bg-green-500" : warn ? "bg-amber-400" : "bg-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

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

  // Keep editing in sync when clients refresh (e.g. after linking Zernio)
  useEffect(() => {
    if (editing) {
      const updated = clients.find((c) => c.id === editing.id);
      if (updated) setEditing(updated);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  async function deleteClient(id: number) {
    if (!confirm("Delete this client? All their content and concepts will also be deleted.")) return;
    const res = await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Delete failed: " + (err?.error ?? res.statusText));
      return;
    }
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
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <ConnBadge
                      label={client.instagramConnection?.zernioAccountId ? "DMs & Scheduling" : "DMs not connected"}
                      ok={!!client.instagramConnection?.zernioAccountId}
                    />
                    <ConnBadge
                      label={client.instagramConnection?.accessToken ? "Meta connected" : "Meta not connected"}
                      ok={!!client.instagramConnection?.accessToken}
                    />
                    <ConnBadge
                      label={client.bookingLink ? "Booking link set" : "No booking link"}
                      ok={!!client.bookingLink}
                    />
                  </div>
                </div>
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
          onRefresh={refreshClients}
        />
      )}
    </div>
  );
}

// ─── Connections section (inside Edit Client modal) ───────────────────────────
function ConnectionsSection({ client, onLinked }: { client: Client; onLinked?: () => void }) {
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accounts, setAccounts]             = useState<any[]>([]);
  const [showPicker, setShowPicker]         = useState(false);
  const [linked, setLinked]                 = useState(!!client.instagramConnection?.zernioAccountId);
  const [linkedUsername, setLinkedUsername] = useState(client.instagramConnection?.igUsername ?? null);
  const [disconnecting, setDisconnecting]   = useState(false);
  const [profileId, setProfileId]           = useState((client.instagramConnection as any)?.zernioProfileId ?? "");

  const metaConnected  = !!client.instagramConnection?.accessToken;
  const zernioConnected = linked;

  async function disconnectZernio() {
    if (!confirm("Disconnect Zernio for this client? DMs and scheduling will stop working.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/zernio/link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      setLinked(false);
      setLinkedUsername(null);
      onLinked?.();
    } catch (e) { alert(String(e)); }
    setDisconnecting(false);
  }

  async function loadAccounts() {
    if (!profileId.trim()) {
      alert("Paste the Zernio Profile ID first (the ID shown next to the profile name in Zernio).");
      return;
    }
    setLoadingAccounts(true);
    setShowPicker(true);
    try {
      const res  = await fetch(`/api/zernio/accounts?profileId=${encodeURIComponent(profileId.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        alert("Zernio error: " + (data?.error ?? res.status) + (data?.raw ? "\n\nRaw: " + JSON.stringify(data.raw) : ""));
        setShowPicker(false);
        setLoadingAccounts(false);
        return;
      }
      const list = Array.isArray(data) ? data : Array.isArray(data.accounts) ? data.accounts : Array.isArray(data.data) ? data.data : [];
      setAccounts(list);
    } catch (e) {
      alert("Network error: " + String(e));
      setShowPicker(false);
    }
    setLoadingAccounts(false);
  }

  async function linkAccount(acc: any) {
    const accountId = acc._id ?? acc.id;
    const igUsername = acc.username ?? acc.igUsername ?? null;
    const res = await fetch("/api/zernio/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, zernioAccountId: accountId, igUsername, zernioProfileId: profileId.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Failed to save: " + (err?.error ?? res.status));
      return;
    }
    setLinked(true);
    setLinkedUsername(igUsername);
    setShowPicker(false);
    setAccounts([]);
    onLinked?.();
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
        <p className="text-xs font-semibold text-slate-700">Connections</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Everything needs to be connected here before the app works for this client.</p>
      </div>

      {/* Row 1: Zernio (DMs & Scheduling) */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-xs font-semibold text-slate-700">📱 DMs & Scheduling (Zernio)</p>
              {zernioConnected
                ? <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">● Connected{linkedUsername ? ` · @${linkedUsername}` : ""}</span>
                : <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">● Not connected</span>
              }
            </div>
            <p className="text-[10px] text-slate-400">Required for DM inbox, sending booking links, and scheduling posts to Instagram.</p>
          </div>
        </div>
        {/* Zernio Profile ID input */}
        <div className="mt-2.5">
          <label className="block text-[10px] font-semibold text-slate-500 mb-1">
            Zernio Profile ID
            <span className="ml-1 font-normal text-slate-400">(copy from the ID shown next to profile name in Zernio)</span>
          </label>
          <input
            type="text"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            placeholder="e.g. 6a19c5997e0625080d4974cb"
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
          />
        </div>

        {!showPicker ? (
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button
              type="button"
              onClick={loadAccounts}
              className="px-3 py-1.5 text-[11px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              {zernioConnected ? "Switch account" : "Link account here"}
            </button>
            {zernioConnected && (
              <button
                type="button"
                onClick={disconnectZernio}
                disabled={disconnecting}
                className="px-3 py-1.5 text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {loadingAccounts ? (
              <p className="text-[11px] text-slate-400">Loading accounts…</p>
            ) : accounts.length === 0 ? (
              <p className="text-[11px] text-slate-400">No accounts found. Make sure the Zernio Profile ID is correct and Instagram is connected in Zernio, then try again.</p>
            ) : (
              accounts.map((acc: any) => {
                const id = acc._id ?? acc.id;
                const uname = acc.username ?? acc.igUsername ?? id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => linkAccount(acc)}
                    className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                  >
                    <span className="font-semibold">@{uname}</span>
                    <span className="text-slate-400 ml-2">{id}</span>
                  </button>
                );
              })
            )}
            <button
              type="button"
              onClick={() => { setShowPicker(false); setAccounts([]); }}
              className="text-[10px] text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Meta Instagram (reels & analytics) */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-xs font-semibold text-slate-700">📊 Reels & Analytics (Meta)</p>
              {metaConnected
                ? <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">● Connected</span>
                : <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full font-medium">● Not connected</span>
              }
            </div>
            <p className="text-[10px] text-slate-400">Optional. Pulls reel performance data and follower analytics from Meta's API. Requires a Business or Creator account.</p>
          </div>
        </div>
        <div className="mt-2.5">
          <a
            href={`/api/auth/instagram?clientId=${client.id}`}
            className="inline-block px-3 py-1.5 text-[11px] font-semibold bg-gradient-to-r from-orange-400 to-pink-500 text-white rounded-lg hover:opacity-90"
          >
            {metaConnected ? "Reconnect Meta ↗" : "Connect Meta Instagram ↗"}
          </a>
        </div>
      </div>
    </div>
  );
}

function InviteLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  return (
    <Modal title="Client Login Link" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <p className="text-sm text-slate-700 mb-1 font-medium">Share this link with your client</p>
          <p className="text-xs text-slate-500">They&apos;ll use it to set their password and access their dashboard. The link expires in 7 days.</p>
        </div>
        <div className="flex items-center gap-2">
          <input readOnly value={url} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 bg-slate-50 focus:outline-none" />
          <button onClick={copy} className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${copied ? "bg-green-600 text-white" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200">Done</button>
        </div>
      </div>
    </Modal>
  );
}

function ClientModal({
  client, onClose, onSaved, onRefresh,
}: {
  client?: Client;
  onClose: () => void;
  onSaved: () => void;
  onRefresh?: () => void;
}) {
  const [step, setStep] = useState<"details" | "connect">("details");
  const [newClientId, setNewClientId] = useState<number | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isTestAccount, setIsTestAccount] = useState(client?.isTestAccount ?? false);
  const [form, setForm] = useState({
    name: client?.name ?? "",
    platform: client?.platform ?? "instagram",
    profileUrl: client?.profileUrl ?? "",
    color: client?.color ?? "#6366f1",
    notes: client?.notes ?? "",
    captionStyle: client?.captionStyle ?? "",
    bookingLink: client?.bookingLink ?? "",
    ctaKeyword: client?.ctaKeyword ?? "",
    loginEmail: "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const method = client ? "PUT" : "POST";
    const url = client ? `/api/clients/${client.id}` : "/api/clients";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, isTestAccount }),
    });
    const data = await res.json();
    if (!client) {
      setNewClientId(data.id);
      onSaved();
      // If email provided, create client login and get invite link
      if (form.loginEmail) {
        const teamRes = await fetch("/api/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.loginEmail,
            role: "Client",
            color: form.color,
            pageAccess: "kanban,concepts,chat,context",
            isClient: true,
            clientId: data.id,
          }),
        });
        const teamData = await teamRes.json();
        if (teamData.inviteUrl) setInviteUrl(teamData.inviteUrl);
      }
      setStep("connect");
    } else {
      onSaved();
      onClose();
    }
  }

  // Show invite link if generated
  if (inviteUrl) {
    return <InviteLinkModal url={inviteUrl} onClose={() => { setInviteUrl(null); onClose(); }} />;
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
            <button onClick={onClose} className="w-full py-2.5 text-sm text-slate-500 hover:text-slate-700">
              Skip for now
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Adding a new client
  if (!client) {
    return (
      <Modal title="Add Client" onClose={onClose}>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client name *</label>
            <input
              required autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client login email</label>
            <input
              type="email"
              value={form.loginEmail}
              onChange={(e) => set("loginEmail", e.target.value)}
              placeholder="client@email.com (optional — generates invite link)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[10px] text-slate-400 mt-1">If provided, a login link will be generated for them to access their dashboard.</p>
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
        {/* ── Connections ─────────────────────────────────────────────── */}
        {client?.id && (
          <ConnectionsSection client={client} onLinked={onRefresh} />
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Booking Link</label>
          <p className="text-[10px] text-slate-400 mb-1.5">Calendly, Cal.com, or any scheduling URL — shown as a one-tap button in DM chats.</p>
          <input type="url" value={form.bookingLink} onChange={(e) => set("bookingLink", e.target.value)}
            placeholder="https://calendly.com/yourname"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {client?.id && (
            <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-medium text-slate-500 mb-1">📡 Booking Webhook URL</p>
              <p className="text-[10px] text-slate-400 mb-1.5">Add this to Calendly → Webhooks or Cal.com → Developer → Webhooks. When someone books, the lead is auto-moved to <strong>Booked</strong>.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 truncate">
                  {`https://ordoagency.com/api/webhooks/booking?clientId=${client.id}`}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(`https://ordoagency.com/api/webhooks/booking?clientId=${client.id}`)}
                  className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 flex-shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">CTA Keyword</label>
          <p className="text-[10px] text-slate-400 mb-1.5">The word people DM from your content CTA (e.g. <strong>regie</strong>). Inbound DMs containing it are auto-flagged as CTA leads and counted in the funnel.</p>
          <input type="text" value={form.ctaKeyword} onChange={(e) => set("ctaKeyword", e.target.value)}
            placeholder="e.g. regie"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
        {/* Test/internal account toggle */}
        <label className="flex items-center justify-between cursor-pointer py-2 border-t border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-700">Internal test account</p>
            <p className="text-[11px] text-slate-400">Enables all WIP pages (pipeline, analytics, DM) for client logins on this account</p>
          </div>
          <button
            type="button"
            onClick={() => setIsTestAccount((v) => !v)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${isTestAccount ? "bg-indigo-600" : "bg-slate-200"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isTestAccount ? "translate-x-4" : "translate-x-1"}`} />
          </button>
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}
