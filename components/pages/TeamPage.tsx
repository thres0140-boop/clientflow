"use client";

import { useEffect, useState } from "react";
import { Client, TeamMember, Creator, MEMBER_COLORS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

type Props = { clients: Client[]; selectedClientId: number | null };

const ALL_PAGES = [
  { id: "pipeline",  label: "Content Scheduling", icon: "📅" },
  { id: "kanban",    label: "Script Kanban",       icon: "📋" },
  { id: "concepts",  label: "Concept Library",     icon: "💡" },
  { id: "analytics", label: "Analytics",           icon: "📊" },
  { id: "dms",       label: "DM Pipeline",         icon: "💌" },
  { id: "instagram", label: "Instagram",           icon: "📸" },
  { id: "board",     label: "Strategy Board",      icon: "🗂️" },
  { id: "team",      label: "Team",                icon: "🤝" },
  { id: "chat",      label: "Messages",            icon: "💬" },
  { id: "settings",  label: "Settings",            icon: "⚙️" },
];

const CLIENT_PAGES = ["pipeline", "kanban", "analytics", "dms", "chat"];

const TEAM_ROLES: { label: string; pages: string[] | "all" }[] = [
  { label: "Editor",           pages: ["pipeline", "kanban", "chat"] },
  { label: "Account Manager",  pages: "all" },
  { label: "Strategist",       pages: ["kanban", "concepts", "analytics", "board", "chat"] },
  { label: "Custom",           pages: "all" }, // shows manual picker
];

function parseAccess(pageAccess: string): string[] {
  if (pageAccess === "all") return ALL_PAGES.map((p) => p.id);
  return pageAccess.split(",").filter(Boolean);
}

export default function TeamPage({ clients, selectedClientId }: Props) {
  const [tab, setTab] = useState<"members" | "creators">("members");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editingCreator, setEditingCreator] = useState<Creator | null>(null);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => { reloadTeam(); reloadCreators(); }, [selectedClientId]);

  async function reloadTeam() {
    const url = selectedClientId ? `/api/team?clientId=${selectedClientId}` : "/api/team";
    setTeam(await fetch(url).then((r) => r.json()));
  }

  async function reloadCreators() {
    const url = selectedClientId ? `/api/creators?clientId=${selectedClientId}` : "/api/creators";
    setCreators(await fetch(url).then((r) => r.json()));
  }

  async function deleteMember(id: number) {
    await fetch(`/api/team/${id}`, { method: "DELETE" });
    reloadTeam();
  }

  async function deleteCreator(id: number) {
    if (!confirm("Remove this creator?")) return;
    await fetch(`/api/creators/${id}`, { method: "DELETE" });
    reloadCreators();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your team and content creators</p>
        </div>
        <button
          onClick={() => tab === "members" ? setShowAdd(true) : setShowAddCreator(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700"
        >
          + Add {tab === "members" ? "Member" : "Creator"}
        </button>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab("members")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === "members" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          🤝 Team Members
        </button>
        <button
          onClick={() => setTab("creators")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === "creators" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          🎬 Creators
        </button>
      </div>

      {tab === "members" ? (
        team.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-14 text-center">
            <div className="text-4xl mb-3">🤝</div>
            <p className="text-slate-500 text-sm mb-4">No team members yet.</p>
            <button onClick={() => setShowAdd(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">+ Add Member</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {team.map((member, idx) => {
              const pages = parseAccess(member.pageAccess);
              const isFullAccess = member.pageAccess === "all" || pages.length === ALL_PAGES.length;
              return (
                <div key={member.id} className={`flex items-center gap-4 px-5 py-4 ${idx !== 0 ? "border-t border-slate-100" : ""}`}>
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundColor: member.color }}>
                    {member.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  {/* Name + role */}
                  <div className="w-44 flex-shrink-0">
                    <p className="font-semibold text-slate-800 text-sm">{member.name}</p>
                    <p className="text-xs text-slate-400">{member.role || (member.isClientAccount ? "Client" : "—")}</p>
                  </div>
                  {/* Email */}
                  <div className="w-52 flex-shrink-0">
                    <p className="text-xs text-slate-400 truncate">{member.email || "—"}</p>
                  </div>
                  {/* Page access */}
                  <div className="flex-1 flex flex-wrap gap-1 min-w-0">
                    {isFullAccess ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-medium rounded-full">✦ Full Access</span>
                    ) : (
                      ALL_PAGES.filter((p) => pages.includes(p.id)).map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-medium rounded-full">{p.icon} {p.label}</span>
                      ))
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex-shrink-0">
                    <MemberActions member={member} onEdit={() => setEditing(member)} onDelete={() => deleteMember(member.id)} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Creators tab */
        creators.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-14 text-center">
            <div className="text-4xl mb-3">🎬</div>
            <p className="text-slate-500 text-sm mb-1">No creators yet.</p>
            <p className="text-xs text-slate-400 mb-4">Creators are the content makers linked to your clients.</p>
            <button onClick={() => setShowAddCreator(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">+ Add Creator</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {creators.map((creator, idx) => (
              <div key={creator.id} className={`flex items-center gap-4 px-5 py-4 ${idx !== 0 ? "border-t border-slate-100" : ""}`}>
                {/* Avatar */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundColor: creator.color }}>
                  {creator.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                {/* Name + handle */}
                <div className="w-44 flex-shrink-0">
                  <p className="font-semibold text-slate-800 text-sm">{creator.name}</p>
                  {creator.instagramHandle && <p className="text-xs text-indigo-400">@{creator.instagramHandle}</p>}
                </div>
                {/* Email */}
                <div className="w-52 flex-shrink-0">
                  <p className="text-xs text-slate-400 truncate">{creator.email || "—"}</p>
                </div>
                {/* Client */}
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  {creator.client ? (
                    <>
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: creator.client.color }} />
                      <span className="text-xs text-slate-500 truncate">{creator.client.name}</span>
                    </>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </div>
                {/* Actions */}
                <div className="flex-shrink-0 flex gap-2">
                  <button onClick={() => setEditingCreator(creator)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Edit</button>
                  <button onClick={() => deleteCreator(creator.id)} className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {showAdd && <MemberModal clientId={selectedClientId} onClose={() => setShowAdd(false)} onSaved={(url) => { setShowAdd(false); reloadTeam(); if (url) setInviteUrl(url); }} />}
      {editing && <MemberModal clientId={selectedClientId} member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadTeam(); }} />}
      {showAddCreator && <CreatorModal clients={clients} onClose={() => setShowAddCreator(false)} onSaved={() => { setShowAddCreator(false); reloadCreators(); }} />}
      {editingCreator && <CreatorModal clients={clients} creator={editingCreator} onClose={() => setEditingCreator(null)} onSaved={() => { setEditingCreator(null); reloadCreators(); }} />}

      {inviteUrl && <InviteLinkModal url={inviteUrl} onClose={() => setInviteUrl(null)} />}
    </div>
  );
}

// ── Member Actions (inline confirm) ────────────────────────────────────────
function MemberActions({ member, onEdit, onDelete }: { member: TeamMember; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Sure?</span>
        <button onClick={() => { onDelete(); setConfirming(false); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Yes</button>
        <button onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">No</button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <button onClick={onEdit} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Edit</button>
      <button onClick={() => setConfirming(true)} className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">Remove</button>
    </div>
  );
}

// ── Member Modal ────────────────────────────────────────────────────────────

function MemberModal({ member, clientId, onClose, onSaved }: { member?: TeamMember; clientId?: number | null; onClose: () => void; onSaved: (inviteUrl?: string) => void }) {
  // Editing a client must open as a client (not default to "team" → "Editor").
  const [memberType, setMemberType] = useState<"team" | "client">(member?.isClientAccount ? "client" : "team");

  // Determine initial role for editing
  const initialRole = member?.role && TEAM_ROLES.find((r) => r.label === member.role)
    ? member.role
    : member && !member.isClientAccount ? "Custom"
    : "Editor";

  const [form, setForm] = useState({ name: member?.name || "", email: member?.email || "", role: initialRole, color: member?.color || "#6366f1" });
  const [selectedPages, setSelectedPages] = useState<string[]>(() => {
    if (member) return parseAccess(member.pageAccess);
    const roleConf = TEAM_ROLES.find((r) => r.label === initialRole);
    return roleConf?.pages === "all" ? ALL_PAGES.map((p) => p.id) : (roleConf?.pages ?? []);
  });
  // Pages the member can VIEW but not edit. Clients default to view-only on every page.
  const [viewOnly, setViewOnly] = useState<string[]>(() => {
    if (member) return (member.viewOnlyPages || "").split(",").filter(Boolean);
    return memberType === "client" ? [...CLIENT_PAGES] : [];
  });

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Per-page access state: "off" (hidden) | "view" (read-only) | "use" (full).
  function pageState(id: string): "off" | "view" | "use" {
    if (!selectedPages.includes(id)) return "off";
    return viewOnly.includes(id) ? "view" : "use";
  }
  function setPageState(id: string, state: "off" | "view" | "use") {
    if (state === "off") {
      setSelectedPages((p) => p.filter((x) => x !== id));
      setViewOnly((v) => v.filter((x) => x !== id));
    } else if (state === "view") {
      setSelectedPages((p) => (p.includes(id) ? p : [...p, id]));
      setViewOnly((v) => (v.includes(id) ? v : [...v, id]));
    } else {
      setSelectedPages((p) => (p.includes(id) ? p : [...p, id]));
      setViewOnly((v) => v.filter((x) => x !== id));
    }
  }

  function switchType(t: "team" | "client") {
    setMemberType(t);
    if (t === "client") { setSelectedPages([...CLIENT_PAGES]); setViewOnly([...CLIENT_PAGES]); }
    else {
      const def = TEAM_ROLES.find((r) => r.label === form.role);
      setSelectedPages(def?.pages === "all" ? ALL_PAGES.map((p) => p.id) : (def?.pages ?? ALL_PAGES.map((p) => p.id)));
      setViewOnly([]);
    }
  }

  function onRoleChange(role: string) {
    set("role", role);
    const roleConf = TEAM_ROLES.find((r) => r.label === role);
    if (roleConf) {
      setSelectedPages(roleConf.pages === "all" ? ALL_PAGES.map((p) => p.id) : roleConf.pages);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pages = selectedPages;
    const pageAccess = pages.length === ALL_PAGES.length ? "all" : pages.join(",");
    const viewOnlyPages = viewOnly.filter((p) => pages.includes(p)).join(",");
    const method = member ? "PUT" : "POST";
    const url = member ? `/api/team/${member.id}` : "/api/team";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, pageAccess, viewOnlyPages, isClient: !member && isClient, clientId: clientId ?? null }) });
    const data = await res.json();
    if (!member && isClient && data.inviteUrl) {
      onSaved(data.inviteUrl);
    } else {
      onSaved();
    }
  }

  const isClient = memberType === "client";
  const isCustomRole = form.role === "Custom";
  const roleConf = TEAM_ROLES.find((r) => r.label === form.role);
  const rolePages = roleConf?.pages === "all" ? ALL_PAGES : ALL_PAGES.filter((p) => Array.isArray(roleConf?.pages) && roleConf.pages.includes(p.id));

  return (
    <Modal title={member ? "Edit Member" : "Add Member"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">

        {/* Type toggle — only shown when adding new */}
        {!member && (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            <button type="button" onClick={() => switchType("team")}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${!isClient ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              🤝 Team
            </button>
            <button type="button" onClick={() => switchType("client")}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-all ${isClient ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              🎬 Client
            </button>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        {!isClient && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {TEAM_ROLES.map((r) => (
                <button key={r.label} type="button" onClick={() => onRoleChange(r.label)}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium text-left transition-all ${form.role === r.label ? "bg-indigo-50 border-indigo-400 text-indigo-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email{isClient ? " *" : ""}</label>
          <input type="email" required={isClient} value={form.email} onChange={(e) => set("email", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        {/* Page access — per page: Off (hidden) / View (read-only) / Use (full) */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Page Access <span className="font-normal text-slate-400">· toggle what they can see, and whether they can edit it</span></label>
          <div className="space-y-1">
            {ALL_PAGES.map((page) => {
              const st = pageState(page.id);
              const OPTIONS: { key: "off" | "view" | "use"; label: string }[] = [
                { key: "off", label: "Hidden" },
                { key: "view", label: "👁 View" },
                { key: "use", label: "✏️ Use" },
              ];
              return (
                <div key={page.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 truncate">
                    <span>{page.icon}</span>{page.label}
                  </span>
                  <div className="flex gap-0.5 bg-white rounded-md border border-slate-200 p-0.5 flex-shrink-0">
                    {OPTIONS.map((o) => (
                      <button key={o.key} type="button" onClick={() => setPageState(page.id, o.key)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                          st === o.key
                            ? (o.key === "off" ? "bg-slate-200 text-slate-600" : o.key === "view" ? "bg-amber-100 text-amber-700" : "bg-indigo-600 text-white")
                            : "text-slate-400 hover:text-slate-600"
                        }`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">👁 View = can open the page but not add/edit/schedule. ✏️ Use = full access.</p>
        </div>

        {!isClient && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {MEMBER_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set("color", c)} className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">{member ? "Save Changes" : (isClient ? "Add Client" : "Add Member")}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Creator Modal ───────────────────────────────────────────────────────────

function CreatorModal({ clients, creator, onClose, onSaved }: { clients: Client[]; creator?: Creator; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    clientId: creator?.clientId?.toString() || clients[0]?.id?.toString() || "",
    name: creator?.name || "",
    email: creator?.email || "",
    instagramHandle: creator?.instagramHandle || "",
    color: creator?.color || "#6366f1",
    notes: creator?.notes || "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const method = creator ? "PUT" : "POST";
    const url = creator ? `/api/creators/${creator.id}` : "/api/creators";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    onSaved();
  }

  return (
    <Modal title={creator ? "Edit Creator" : "Add Creator"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Client *</label>
          <select required value={form.clientId} onChange={(e) => set("clientId", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Select client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Instagram Handle</label>
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
            <span className="px-3 text-sm text-slate-400 bg-slate-50 border-r border-slate-200 py-2">@</span>
            <input value={form.instagramHandle} onChange={(e) => set("instagramHandle", e.target.value)} placeholder="username" className="flex-1 px-3 py-2 text-sm focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Shooting days, preferences, etc." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Color</label>
          <div className="flex flex-wrap gap-2">
            {MEMBER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set("color", c)} className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">{creator ? "Save Changes" : "Add Creator"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Invite Link Modal ────────────────────────────────────────────────────────

function InviteLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal title="Client Invite Link" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <p className="text-sm text-slate-700 mb-1 font-medium">Share this link with your client</p>
          <p className="text-xs text-slate-500">They&apos;ll use it to set their password and access their portal. The link expires in 7 days.</p>
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
