"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Client } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false, loading: () => <BoardSkeleton /> }
);

type Props = {
  clients: Client[];
  selectedClientId: number | null;
};

export default function BoardPage({ clients, selectedClientId }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  if (!client) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Select a client to open their board
      </div>
    );
  }

  return <BoardCanvas key={client.id} client={client} />;
}

function BoardCanvas({ client }: { client: Client }) {
  const apiRef = useRef<{ getSceneElements: AnyFn; getAppState: AnyFn } | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "">("");

  const getInitialData = useCallback(async () => {
    try {
      const res = await fetch(`/api/board?clientId=${client.id}`);
      const { snapshot } = await res.json();
      if (snapshot && snapshot !== "{}") {
        return JSON.parse(snapshot);
      }
    } catch {
      // fresh board
    }
    return null;
  }, [client.id]);

  const handleChange = useCallback((elements: unknown, appState: unknown, files: unknown) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    setSaveState("saving");
    saveTimeout.current = setTimeout(async () => {
      try {
        const snapshot = {
          elements,
          appState: { ...(appState as Record<string, unknown>), collaborators: [] },
          files,
        };
        await fetch("/api/board", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, snapshot: JSON.stringify(snapshot) }),
        });
        setSaveState("saved");
        setTimeout(() => setSaveState(""), 2000);
      } catch {
        setSaveState("");
      }
    }, 1500);
  }, [client.id]);

  return (
    <>
      {/* Save indicator */}
      <div className="absolute top-2 right-4 z-20 pointer-events-none">
        <span className={`text-[10px] font-medium transition-opacity ${
          saveState === "saving" ? "text-slate-400 opacity-100"
          : saveState === "saved" ? "text-green-600 opacity-100"
          : "opacity-0"
        }`}>
          {saveState === "saving" ? "Saving…" : "✓ Saved"}
        </span>
      </div>

      {/* Full canvas — fills everything right of the sidebar */}
      <div className="absolute inset-0 left-64">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={getInitialData}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              toggleTheme: true,
              saveToActiveFile: false,
              saveAsImage: true,
            },
          }}
        />
      </div>
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="absolute inset-0 left-64 flex items-center justify-center bg-[#f8f9fa]">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm">Loading board…</p>
      </div>
    </div>
  );
}
