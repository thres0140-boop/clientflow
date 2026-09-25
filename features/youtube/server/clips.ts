// Clipping: turn a window of a long-form YouTube video into a draft on another platform that the
// video editor opens already trimmed. One function, called by POST /api/clipping/clips.
import { prisma } from "@/shared/db/prisma";
import { logActivity } from "@/shared/activity";
import { isPlatformId, type PlatformId } from "@/shared/agencyPlatforms";
import { ensureDefaultStages } from "@/features/scripts/server/ensureStages";
import { createDocumentFromRawUrls, type VideoTrack } from "@/features/editor/model/document";
import { captionStyleForClient } from "@/features/editor/model/captionStyle";

export type CreateClipInput = {
  sourceDraftId: number;
  sourceUrl: string;
  platform: string;
  conceptId: number;
  title: string;
  inMs: number;
  outMs: number;
  script: string;                 // the transcript text for exactly [inMs, outMs)
  meta?: { durationMs?: number | null; width?: number | null; height?: number | null };
  actor: string;
};

export type CreateClipResult = { ok: true; draftId: number; projectId: number } | { ok: false; status: number; error: string };

// Same convention as the Kanban's card label ("Week 39").
function weekLabel(): string {
  const n = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `Week ${n}`;
}

export const CLIP_MIN_MS = 1000;
export const CLIP_MAX_MS = 5 * 60 * 1000; // a short clip; the editor's own ceiling is 15 min

export async function createClipDraft(input: CreateClipInput): Promise<CreateClipResult> {
  const { sourceDraftId, sourceUrl, conceptId, actor } = input;
  const platform = input.platform as PlatformId;
  if (!isPlatformId(platform)) return { ok: false, status: 400, error: `Unknown platform "${input.platform}"` };
  const inMs = Math.max(0, Math.round(input.inMs)), outMs = Math.round(input.outMs);
  if (!(outMs - inMs >= CLIP_MIN_MS)) return { ok: false, status: 400, error: "A clip must be at least 1 second long." };
  if (outMs - inMs > CLIP_MAX_MS) return { ok: false, status: 400, error: `A clip can be at most ${CLIP_MAX_MS / 60000} minutes long.` };
  const title = input.title.trim();
  if (!title) return { ok: false, status: 400, error: "Give the clip a title." };

  const source = await prisma.scriptDraft.findUnique({
    where: { id: sourceDraftId },
    select: { id: true, clientId: true, title: true, rawContentUrls: true, editedVideoUrl: true, client: { select: { subtitleStyle: true, instagramEnabled: true, youtubeEnabled: true } } },
  });
  if (!source) return { ok: false, status: 404, error: "Source video not found." };
  let raw: string[] = [];
  try { raw = JSON.parse(source.rawContentUrls || "[]"); } catch { raw = []; }
  if (sourceUrl !== source.editedVideoUrl && !raw.includes(sourceUrl)) return { ok: false, status: 400, error: "That video does not belong to the source draft." };

  // The target must be a platform this client has switched on.
  const flags = source.client;
  const enabled: PlatformId[] = [];
  if (flags.instagramEnabled !== false) enabled.push("instagram");
  if (flags.youtubeEnabled) enabled.push("youtube");
  if (!enabled.includes(platform)) return { ok: false, status: 400, error: `${platform} is not switched on for this client.` };

  // The concept is the operator's choice (never a synthetic bucket): it must exist on the target
  // platform and belong to this client or be global.
  const concept = await prisma.concept.findUnique({ where: { id: conceptId }, select: { id: true, clientId: true, platform: true } });
  if (!concept || (concept.clientId != null && concept.clientId !== source.clientId)) return { ok: false, status: 400, error: "Pick a concept for this client." };
  if ((concept.platform || "instagram") !== platform) return { ok: false, status: 400, error: `That concept belongs to ${concept.platform || "instagram"}, not ${platform}.` };

  // Land in the target platform's Edit stage: that column hosts "Open in editor".
  const stages = await ensureDefaultStages(source.clientId, platform);
  const edit = stages.find((s) => s.name.trim().toLowerCase() === "edit") ?? stages[0];

  const draft = await prisma.scriptDraft.create({
    data: {
      clientId: source.clientId,
      platform,
      conceptId,
      title,
      hook: null,
      script: input.script.trim(),
      weekLabel: weekLabel(),
      stageId: edit?.id ?? null,
      status: edit ? "accepted" : "pending",
      isSavedIdea: false,
      rawContentUrls: JSON.stringify([sourceUrl]),
      clipOfDraftId: source.id,
    },
  });

  // The edit project, created here rather than on first open, so the editor lands on the window:
  // the source is the one asset, the main track is one clip trimmed to [inMs, outMs), centred and
  // fit to the 9:16 canvas height (a 16:9 master becomes a centre crop the operator can reframe).
  const doc = createDocumentFromRawUrls([sourceUrl], captionStyleForClient(flags.subtitleStyle));
  const asset = doc.assets[0];
  if (asset) {
    asset.name = source.title;
    asset.durationMs = input.meta?.durationMs != null && Number.isFinite(input.meta.durationMs) ? Math.round(input.meta.durationMs) : null;
    asset.width = input.meta?.width != null && Number.isFinite(input.meta.width) ? Math.round(input.meta.width) : null;
    asset.height = input.meta?.height != null && Number.isFinite(input.meta.height) ? Math.round(input.meta.height) : null;
  }
  const main = doc.tracks.find((t): t is VideoTrack => t.kind === "video" && t.role === "main");
  const clip = main?.clips[0];
  if (clip) { clip.inMs = inMs; clip.outMs = outMs; }
  const project = await prisma.editProject.create({ data: { draftId: draft.id, clientId: source.clientId, document: JSON.stringify(doc), updatedBy: actor } });

  logActivity({ clientId: source.clientId, actor, type: "footage_uploaded", title: `Clip: ${title}`, detail: `Cut ${fmt(inMs)}–${fmt(outMs)} from "${source.title}" for ${platform}`, draftId: draft.id }).catch(() => {});
  return { ok: true, draftId: draft.id, projectId: project.id };
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
