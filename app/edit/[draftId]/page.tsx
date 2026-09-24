"use client";

import { use } from "react";
import EditorPage from "@/features/editor/pages/EditorPage";

// /edit/<draftId> — the video editor for one ScriptDraft. Reached from the Edit stage of the
// Script Kanban. A full-screen route of its own rather than a Page in app/page.tsx: the editor
// wants the whole viewport and no sidebar, and the session gate in proxy.ts covers it like any
// other non-public path.
export default function EditRoute({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = use(params);
  return <EditorPage draftId={parseInt(draftId, 10)} />;
}
