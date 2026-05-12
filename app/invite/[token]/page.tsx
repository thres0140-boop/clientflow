"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; email: string | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErrorMsg(d.error);
        else setInfo(d);
      });
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setErrorMsg("Passwords don't match"); return; }
    if (password.length < 6) { setErrorMsg("Password must be at least 6 characters"); return; }
    setErrorMsg("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Something went wrong"); return; }
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl mb-4 shadow-lg shadow-indigo-900/50">
            <span className="text-2xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">ORDO</h1>
          <p className="text-slate-400 text-sm mt-1">Set up your account</p>
        </div>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 shadow-2xl">
          {done ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-semibold">Password set!</p>
              <p className="text-slate-400 text-sm mt-1">Redirecting to login…</p>
            </div>
          ) : errorMsg && !info ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="text-red-400 text-sm">{errorMsg}</p>
            </div>
          ) : !info ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 mb-2">
                <p className="text-sm text-white font-medium">Hey, {info.name}! 👋</p>
                {info.email && <p className="text-xs text-slate-400 mt-0.5">{info.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Choose a password</label>
                <input
                  type="password" required autoFocus
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Confirm password</label>
                <input
                  type="password" required
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 text-sm text-red-400">
                  {errorMsg}
                </div>
              )}
              <button
                type="submit" disabled={submitting}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {submitting ? "Setting up…" : "Create account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
