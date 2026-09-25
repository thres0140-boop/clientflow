// Server-side access to EditProject rows: get-or-create for a draft, and an optimistic-locked
// save. Every route goes through here so the version rule lives in one place.
import { prisma } from "@/shared/db/prisma";
import { createDocumentFromRawUrls, type EditDocument, normalizeDocument, parseDocument } from "@/features/editor/model/document";
import { captionStyleForClient } from "@/features/editor/model/captionStyle";
import { type ClientCaptionSettings, parseClientCaptionSettings } from "@/features/editor/model/captionPresets";

export type EditProjectView = {
  id: number;
  draftId: number;
  clientId: number;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  document: EditDocument;
  clientCaptions: ClientCaptionSettings; // the client's default style and own presets (Client.subtitleStyle)
};

async function toView(row: { id: number; draftId: number; clientId: number; version: number; updatedBy: string | null; updatedAt: Date; document: string }): Promise<EditProjectView> {
  const client = await prisma.client.findUnique({ where: { id: row.clientId }, select: { subtitleStyle: true } });
  return { id: row.id, draftId: row.draftId, clientId: row.clientId, version: row.version, updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString(), document: parseDocument(row.document), clientCaptions: parseClientCaptionSettings(client?.subtitleStyle) };
}

/** The project for a draft, created on first open from the draft's rawContentUrls and the
 *  client's default caption style. Returns null if the draft does not exist. */
export async function getOrCreateProjectForDraft(draftId: number): Promise<EditProjectView | null> {
  const existing = await prisma.editProject.findUnique({ where: { draftId } });
  if (existing) return toView(existing);
  const draft = await prisma.scriptDraft.findUnique({ where: { id: draftId }, select: { id: true, clientId: true, rawContentUrls: true, client: { select: { subtitleStyle: true } } } });
  if (!draft) return null;
  let rawUrls: string[] = [];
  try { rawUrls = JSON.parse(draft.rawContentUrls || "[]"); } catch { rawUrls = []; }
  const doc = createDocumentFromRawUrls(rawUrls, captionStyleForClient(draft.client.subtitleStyle));
  try {
    const created = await prisma.editProject.create({ data: { draftId, clientId: draft.clientId, document: JSON.stringify(doc) } });
    return toView(created);
  } catch {
    // Two devices opened the draft at the same moment; the unique draftId made one of them lose.
    const raced = await prisma.editProject.findUnique({ where: { draftId } });
    return raced ? toView(raced) : null;
  }
}

export async function getProject(id: number): Promise<EditProjectView | null> {
  const row = await prisma.editProject.findUnique({ where: { id } });
  return row ? toView(row) : null;
}

export type SaveResult = { ok: true; project: EditProjectView } | { ok: false; conflict: EditProjectView };

/** Saves a document if and only if the row is still at `expectedVersion`. Otherwise returns the
 *  current row so the caller can show who saved in between and let the person choose. */
export async function saveDocument(id: number, input: unknown, expectedVersion: number, by: string | null): Promise<SaveResult | null> {
  const doc = normalizeDocument(input);
  const updated = await prisma.editProject.updateMany({
    where: { id, version: expectedVersion },
    data: { document: JSON.stringify(doc), version: expectedVersion + 1, updatedBy: by },
  });
  const row = await prisma.editProject.findUnique({ where: { id } });
  if (!row) return null;
  const view = await toView(row);
  return updated.count === 1 ? { ok: true, project: view } : { ok: false, conflict: view };
}
