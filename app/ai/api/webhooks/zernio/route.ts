import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/ai/db/prisma";
import { sendWhatsApp } from "@/shared/notify/notify";
import { deletePostedMedia } from "@/ai/shared/media/mediaCleanup";
import { logActivity } from "@/ai/shared/activity";

export const runtime = "nodejs";

// POST /ai/api/webhooks/zernio — the AI product's OWN Zernio webhook.
//
// Register it in Zernio with `profileIds` = this product's profile(s) and a `secret`
// (POST /v1/webhooks/settings). This route is the last line of defence, because a published
// event ends in an irreversible media delete:
//   1. the HMAC-SHA256 signature over the raw body must verify (fail closed if no secret);
//   2. the event's profileId must be in AI_ZERNIO_PROFILE_IDS — anything else is ignored
//      BEFORE any matching logic runs;
//   3. a draft or piece is matched ONLY by its stored zernioPostId. There is no caption or
//      time-window fallback, so nothing can ever be marked posted (or have media deleted)
//      by guesswork.

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = header.replace(/^sha256=/i, "").trim();
  const digest = createHmac("sha256", secret).update(raw, "utf8").digest();
  const candidates = [digest.toString("hex"), digest.toString("base64")];
  return candidates.some((c) => {
    const a = Buffer.from(c), b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function allowedProfiles(): string[] {
  return (process.env.AI_ZERNIO_PROFILE_IDS || process.env.AI_ZERNIO_PROFILE_ID || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  const secret = process.env.AI_ZERNIO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
  if (!verifySignature(raw, sig, secret)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const post = body.post ?? body.data ?? body;
  const profileId = String(post?.profileId ?? body?.profileId ?? "");
  const allowed = allowedProfiles();
  if (!profileId || !allowed.includes(profileId)) {
    console.log("[ai zernio-webhook] ignored event for profile", profileId || "(none)");
    return NextResponse.json({ ok: true, ignored: "profile_not_ours" }, { status: 202 });
  }

  const event = String(req.headers.get("x-zernio-event") ?? body.event ?? body.type ?? body.name ?? "").toLowerCase();
  const zernioPostId = String(post?._id ?? post?.id ?? post?.postId ?? "");
  if (!zernioPostId) return NextResponse.json({ ok: true, ignored: "no_post_id" }, { status: 202 });

  if (event.includes("publish") && !event.includes("unpublish")) await handlePublished(post, zernioPostId);
  else if (event.includes("fail")) await handleFailed(post, zernioPostId);
  else if (event.includes("schedul")) await handleScheduled(post, zernioPostId);

  return NextResponse.json({ ok: true });
}

function conceptLabelOf(draft: any): string | null {
  const c = draft?.concept;
  if (!c) return null;
  if (c.conceptType && c.name) return `${c.conceptType} · ${c.name}`;
  return c.conceptType || c.name || null;
}

async function handleScheduled(post: any, zernioPostId: string) {
  try {
    const draft = await (prisma as any).scriptDraft.findFirst({ where: { zernioPostId }, include: { concept: { select: { name: true, conceptType: true } } } });
    if (!draft) return;
    const when = post.scheduledFor ?? post.scheduledAt ?? null;
    let whenStr = "";
    if (when) { try { whenStr = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(new Date(when)); } catch { /* ignore */ } }
    const cLabel = conceptLabelOf(draft);
    sendWhatsApp(`🗓 [AI] Zernio confirmed scheduled: "${draft.title}"${cLabel ? ` (${cLabel})` : ""}${whenStr ? `\n→ auto-posts ${whenStr}` : ""}`).catch(() => {});
  } catch (err) { console.error("[ai zernio-webhook] handleScheduled error:", err); }
}

async function handlePublished(post: any, zernioPostId: string) {
  try {
    const platforms: any[] = post.platforms ?? post.accounts ?? [];
    const plat = platforms.find((p: any) => ["instagram", "tiktok"].includes(String(p.platform ?? p.type ?? "").toLowerCase())) ?? platforms[0];
    const platformPostId: string | null = plat?.platformPostId ?? plat?.mediaId ?? plat?.postId ?? null;

    // DEFINITIVE id only.
    const piece = await (prisma as any).contentPiece.findFirst({ where: { zernioPostId } });
    if (piece) {
      await (prisma as any).contentPiece.update({ where: { id: piece.id }, data: { status: "posted", ...(platformPostId ? { igMediaId: platformPostId } : {}) } });
    }

    const draft = await (prisma as any).scriptDraft.findFirst({ where: { zernioPostId }, include: { concept: { select: { name: true, conceptType: true } } } });
    if (!draft) { console.log("[ai zernio-webhook] published post has no matching draft by id:", zernioPostId); return; }

    await (prisma as any).scriptDraft.update({ where: { id: draft.id }, data: { status: "posted" } });

    // Live now → purge raw clips + finished cut from THIS product's bucket. deleteMediaUrl refuses
    // any URL outside AI_R2_PUBLIC_BASE_URL, so copied agency-bucket URLs are never touched.
    try {
      const rawUrls: string[] = JSON.parse(draft.rawContentUrls || "[]");
      const removed = await deletePostedMedia([...rawUrls, draft.editedVideoUrl]);
      await (prisma as any).scriptDraft.update({ where: { id: draft.id }, data: { rawContentUrls: "[]", editedVideoUrl: null } });
      console.log(`[ai zernio-webhook] media cleanup for draft ${draft.id}: removed ${removed}`);
    } catch (e) { console.error("[ai zernio-webhook] media cleanup failed for draft", draft.id, e); }

    const cLabel = conceptLabelOf(draft);
    const permalink = post.permalink ?? plat?.permalink ?? plat?.url ?? null;
    sendWhatsApp(`✅ [AI] LIVE: "${draft.title}"${cLabel ? ` (${cLabel})` : ""}${permalink ? `\n🔗 ${permalink}` : ""}`).catch(() => {});
    logActivity({ clientId: draft.clientId, actor: "System", type: "posted", title: draft.title, detail: cLabel || "live", draftId: draft.id });
  } catch (err) { console.error("[ai zernio-webhook] handlePublished error:", err); }
}

async function handleFailed(post: any, zernioPostId: string) {
  try {
    console.error("[ai zernio-webhook] post FAILED:", zernioPostId, post.failureReason ?? post.error);
    const piece = await (prisma as any).contentPiece.findFirst({ where: { zernioPostId } });
    if (piece) await (prisma as any).contentPiece.update({ where: { id: piece.id }, data: { status: "edited" } });
    const draft = await (prisma as any).scriptDraft.findFirst({ where: { zernioPostId } });
    if (draft) sendWhatsApp(`⚠️ [AI] Post FAILED: "${draft.title}" — check Zernio.`).catch(() => {});
  } catch (err) { console.error("[ai zernio-webhook] handleFailed error:", err); }
}
