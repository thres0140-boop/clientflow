"use client";

import { useEffect, useState } from "react";
import { Client, Concept } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };

export default function AIScripts({ clients, selectedClientId }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState("");
  const [generatedScript, setGeneratedScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyMissing, setKeyMissing] = useState(false);

  useEffect(() => {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    fetch(`/api/concepts${qs}`).then((r) => r.json()).then(setConcepts);
  }, [selectedClientId]);

  const selectedConcept = concepts.find((c) => c.id === parseInt(selectedConceptId));
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;

  async function generate() {
    if (!selectedConcept) { setError("Please select a concept."); return; }
    setLoading(true);
    setError("");
    setKeyMissing(false);
    setGeneratedScript("");
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: selectedConcept,
          language: activeClient?.language || "nl",
          clientName: activeClient?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.includes("ANTHROPIC_API_KEY")) setKeyMissing(true);
        else setError(data.error || "Failed to generate script.");
        return;
      }
      setGeneratedScript(data.script);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">AI Script Generator</h1>
        <p className="text-slate-500 mt-1">Turn concept blueprints into ready-to-use scripts using Claude</p>
      </div>

      {keyMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Anthropic API key not set</p>
          <p>Open <code className="bg-amber-100 px-1 rounded">/Users/cenk/clientflow/.env.local</code> and set:</p>
          <code className="block mt-2 bg-amber-100 px-3 py-2 rounded font-mono text-xs">ANTHROPIC_API_KEY=sk-ant-...</code>
          <p className="mt-2 text-xs text-amber-600">Then restart the dev server for it to take effect.</p>
        </div>
      )}

      {/* Concept selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Select Concept</h2>
        <select
          value={selectedConceptId}
          onChange={(e) => setSelectedConceptId(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— Choose a concept —</option>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.client ? ` (${c.client.name})` : " (Global)"}</option>
          ))}
        </select>

        {selectedConcept && (
          <div className="mt-4 space-y-2 bg-slate-50 rounded-lg p-4 text-sm">
            {selectedConcept.hookType && <p><span className="font-medium text-slate-600">Hook Type:</span> <span className="text-indigo-600">{selectedConcept.hookType}</span></p>}
            {selectedConcept.textHook && <p><span className="font-medium text-slate-600">Text Hook:</span> {selectedConcept.textHook}</p>}
            {selectedConcept.videoType && <p><span className="font-medium text-slate-600">Video Type:</span> {selectedConcept.videoType}</p>}
            {selectedConcept.angle && <p><span className="font-medium text-slate-600">Angle:</span> {selectedConcept.angle}</p>}
            {selectedConcept.structure && <p><span className="font-medium text-slate-600">Structure:</span> {selectedConcept.structure}</p>}
            {selectedConcept.guidelines && <p><span className="font-medium text-slate-600">Guidelines:</span> {selectedConcept.guidelines}</p>}
          </div>
        )}

        {activeClient && (
          <p className="mt-3 text-xs text-slate-400">
            Generating in <span className="font-medium text-slate-600">{activeClient.language === "nl" ? "Dutch" : activeClient.language}</span> for {activeClient.name}
          </p>
        )}
      </div>

      <button
        onClick={generate}
        disabled={loading || !selectedConcept}
        className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "✨ Generating with Claude..." : "✨ Generate Script"}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-600">{error}</div>
      )}

      {generatedScript && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Generated Script</h2>
            <button onClick={() => navigator.clipboard.writeText(generatedScript)} className="text-xs text-indigo-600 hover:underline">
              Copy
            </button>
          </div>
          <pre className="text-sm font-mono whitespace-pre-wrap text-slate-700 bg-slate-50 rounded-lg p-4 border border-slate-200">
            {generatedScript}
          </pre>
        </div>
      )}
    </div>
  );
}
