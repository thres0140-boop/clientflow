import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/shared/db/prisma";
import { sendWhatsApp } from "@/shared/notify/notify";
import { deletePostedMedia } from "@/shared/media/mediaCleanup";
import { logActivity } from "@/shared/activity";

export const runtime = "nodejs";

// POST /api/webhooks/zernio
// Receives Zernio webhook events for post.published, post.failed, post.scheduled.
//
// This route is public (proxy.ts PUBLIC) and its published-path ends in an irreversible R2
// delete, so it is guarded in four layers — see POST():
//   1. signature  — HMAC-SHA256 over the raw body (X-Zernio-Signature). Enforced only once
//                   ZERNIO_WEBHOOK_SECRET is set (so a live subscription without a secret keeps
//                   delivering); logs loudly while it is absent.
//   2. profile    — events whose profileId is not one of ours are ignored before any matching.
//   3. dedupe     — X-Zernio-Event-Id is recorded; a replayed delivery is a no-op.
//   4. deletion   — media is purged ONLY when the draft was found by its stored zernioPostId.
//                   Caption-prefix and time-window matches may mark a draft posted, never delete.

// ── 1. signature ─────────────────────────────────────────────────────────────
function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = header.replace(/^sha256=/i, "").trim();
  const digest = createHmac("sha256", secret).update(raw, "utf8").digest();
  return [digest.toString("hex"), digest.toString("base64")].some((c) => {
    const a = Buffer.from(c), b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// ── 2. profile allowlist ─────────────────────────────────────────────────────
// ZERNIO_WEBHOOK_PROFILE_IDS (comma list) if set; otherwise every profile id this database knows:
// the default ZERNIO_PROFILE_ID plus per-client Instagram / TikTok profile ids.
async function allowedProfiles(): Promise<Set<string>> {
  const env = (process.env.ZERNIO_WEBHOOK_PROFILE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.length) return new Set(env);
  const set = new Set<string>();
  if (process.env.ZERNIO_PROFILE_ID) set.add(process.env.ZERNIO_PROFILE_ID);
  try {
    const ig = await (prisma as any).instagramConnection.findMany({ where: { zernioProfileId: { not: null } }, select: { zernioProfileId: true } });
    for (const c of ig) if (c.zernioProfileId) set.add(String(c.zernioProfileId));
    const tt = await (prisma as any).client.findMany({ where: { tiktokZernioProfileId: { not: null } }, select: { tiktokZernioProfileId: true } });
    for (const c of tt) if (c.tiktokZernioProfileId) set.add(String(c.tiktokZernioProfileId));
  } catch (e) { console.error("[zernio-webhook] profile allowlist lookup failed:", e); }
  return set;
}

// ── 3. dedupe ────────────────────────────────────────────────────────────────
// Durable ledger of processed event ids (Zernio sends the same X-Zernio-Event-Id on every
// delivery of one event). Plain table, created on first use; not part of the Prisma schema.
let ledgerReady = false;
async function alreadyProcessed(eventId: string): Promise<boolean> {
  if (!ledgerReady) {
    await (prisma as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ZernioWebhookEvent" ("id" TEXT PRIMARY KEY, "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
    ledgerReady = true;
  }
  const inserted: number = await (prisma as any).$executeRawUnsafe(`INSERT INTO "ZernioWebhookEvent" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING`, eventId);
  return inserted === 0;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // 1. Signature — enforced only once a secret is configured (see header comment).
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
    if (!verifySignature(raw, sig, secret)) {
      console.error("[zernio-webhook] REJECTED: bad or missing signature");
      return NextResponse.json({ error: "bad_signature" }, { status: 401 });
    }
  } else {
    console.error("[zernio-webhook] WARNING: ZERNIO_WEBHOOK_SECRET is not set — deliveries are NOT signature-verified. Set a secret on the Zernio subscription and in this env to enforce.");
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 2. Profile — a foreign profile is ignored before any matching. An event that carries no
  //    profileId at all cannot be classified; it proceeds (it can still only MARK, never delete).
  const post = body.post ?? body.data ?? body;
  const profileId = post?.profileId != null ? String(post.profileId) : body?.profileId != null ? String(body.profileId) : "";
  if (profileId) {
    const allowed = await allowedProfiles();
    if (!allowed.has(profileId)) {
      console.log("[zernio-webhook] ignored event for foreign profile", profileId);
      return NextResponse.json({ ok: true, ignored: "profile_not_ours" }, { status: 202 });
    }
  } else {
    console.log("[zernio-webhook] event carries no profileId — cannot scope it");
  }

  // 3. Dedupe on the event id.
  const eventId = req.headers.get("x-zernio-event-id") ?? req.headers.get("x-late-event-id");
  if (eventId) {
    try {
      if (await alreadyProcessed(eventId)) {
        console.log("[zernio-webhook] duplicate delivery ignored:", eventId);
        return NextResponse.json({ ok: true, duplicate: true });
      }
    } catch (e) { console.error("[zernio-webhook] dedupe ledger error (continuing):", e); }
  } else {
    console.log("[zernio-webhook] no event id header — cannot dedupe");
  }

  const event = String(body.event ?? body.type ?? body.name ?? "").toLowerCase();
  console.log("[zernio-webhook] event:", event, JSON.stringify(body).slice(0, 500));

  // Match on substrings so we catch post.published, post.platform.published, published, etc.
  if (event.includes("publish") && !event.includes("unpublish")) {
    await handlePublished(body);
  } else if (event.includes("fail")) {
    await handleFailed(body);
  } else if (event.includes("schedul")) {
    await handleScheduled(body);
  }

  return NextResponse.json({ ok: true });
}

// Always "Type · Name" (e.g. "Viral · A") — never the bare variant.
function conceptLabelOf(draft: any): string | null {
  const c = draft?.concept;
  if (!c) return null;
  if (c.conceptType && c.name) return `${c.conceptType} · ${c.name}`;
  return c.conceptType || c.name || null;
}

// post.scheduled — Zernio confirms the auto-post is booked. Ping so the user knows
// the schedule registered (the "webhook back from Zernio to confirm").
async function handleScheduled(body: any) {
  try {
    const post = body.post ?? body.data ?? body;
    const zernioPostId = String(post._id ?? post.id ?? post.postId ?? "");
    if (!zernioPostId) return;
    const draft = await (prisma as any).scriptDraft.findFirst({
      where: { zernioPostId },
      include: { concept: { select: { name: true, conceptType: true } } },
    });
    if (!draft) return;
    const cLabel = conceptLabelOf(draft);
    const when = post.scheduledFor ?? post.scheduledAt ?? post.scheduled_at ?? null;
    let whenStr = "";
    if (when) {
      try {
        whenStr = new Intl.DateTimeFormat("en-GB", {
          weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          timeZone: "Europe/Amsterdam",
        }).format(new Date(when));
      } catch { /* ignore */ }
    }
    sendWhatsApp(`🗓 Zernio confirmed scheduled: "${draft.title}"${cLabel ? ` (${cLabel})` : ""}${whenStr ? `\n→ auto-posts ${whenStr}` : ""}`).catch(() => {});
  } catch (err) {
    console.error("[zernio-webhook] handleScheduled error:", err);
  }
}

async function handlePublished(body: any) {
  try {
    const post = body.post ?? body.data ?? body;
    const zernioPostId = String(post._id ?? post.id ?? post.postId ?? "");
    // Instagram media ID may be in platforms array or directly on post
    const platforms: any[] = post.platforms ?? post.accounts ?? [];
    const igPlatform = platforms.find((p: any) =>
      (p.platform ?? p.type ?? "").toLowerCase() === "instagram"
    );
    const igMediaId: string | null = igPlatform?.platformPostId ?? igPlatform?.mediaId ?? igPlatform?.postId ?? null;

    const content: string = (post.content ?? "").trim();

    // Match ContentPiece — try several strategies, most specific first.
    let piece: any = null;

    // 1. By stored Zernio post ID (most reliable for new posts)
    if (zernioPostId) {
      piece = await (prisma as any).contentPiece.findFirst({ where: { zernioPostId } });
    }

    // 2. By caption/content match among not-yet-posted pieces
    if (!piece && content) {
      const candidates = await (prisma as any).contentPiece.findMany({
        where: { status: { in: ["scheduled", "edited"] } },
        orderBy: { createdAt: "desc" },
      });
      piece = candidates.find((c: any) => {
        const cap = (c.caption ?? c.title ?? "").trim();
        return cap === content || cap.startsWith(content) || content.startsWith(cap.split("\n")[0]);
      }) ?? null;
    }

    // 3. By scheduledDate proximity — wide ±3h window to tolerate timezone storage differences
    if (!piece) {
      const postTime = post.scheduledFor ?? post.publishedAt ?? post.scheduledAt ?? post.scheduled_at ?? post.created_at;
      if (postTime) {
        const ts = new Date(postTime).getTime();
        const THREE_H = 3 * 60 * 60 * 1000;
        const candidates = await (prisma as any).contentPiece.findMany({
          where: { status: { in: ["scheduled", "edited"] }, scheduledDate: { not: null } },
        });
        piece = candidates.find((c: any) => {
          if (!c.scheduledDate) return false;
          return Math.abs(new Date(c.scheduledDate).getTime() - ts) <= THREE_H;
        }) ?? null;
      }
    }

    if (piece) {
      const updateData: any = { status: "posted" };
      if (igMediaId) updateData.igMediaId = igMediaId;
      if (zernioPostId && !piece.zernioPostId) updateData.zernioPostId = zernioPostId; // backfill
      await (prisma as any).contentPiece.update({
        where: { id: piece.id },
        data: updateData,
      });
      console.log(`[zernio-webhook] marked piece ${piece.id} as posted${igMediaId ? ` igMediaId=${igMediaId}` : ""}`);
    } else {
      console.log("[zernio-webhook] no matching ContentPiece found for published post; content=", content);
    }

    // Also flip the matching script draft (the calendar card) to posted → green.
    // Try the stored Zernio id first, then fall back to a booked draft matched by
    // caption or by scheduled-time proximity (for posts booked before we stored the id).
    const conceptInclude = { concept: { select: { name: true, conceptType: true } } };
    let draft: any = zernioPostId ? await (prisma as any).scriptDraft.findFirst({ where: { zernioPostId }, include: conceptInclude }) : null;
    // 4. DEFINITIVE only if found by the stored id. Fallback matches below may mark, never delete.
    const definitive = !!draft;
    if (!draft) {
      const booked = await (prisma as any).scriptDraft.findMany({
        where: { zernioBooked: true, status: { not: "posted" } },
        include: conceptInclude,
      });
      if (content) {
        draft = booked.find((d: any) => {
          const cap = (d.caption ?? "").trim();
          return cap && (cap === content || content.startsWith(cap.split("\n")[0]) || cap.startsWith(content.split("\n")[0]));
        }) ?? null;
      }
      if (!draft) {
        const postTime = post.scheduledFor ?? post.publishedAt ?? post.scheduledAt ?? post.created_at;
        const ts = postTime ? new Date(postTime).getTime() : Date.now();
        draft = booked.find((d: any) => {
          if (!d.scheduledDate) return false;
          const dt = new Date(d.scheduledDate.includes("T") ? d.scheduledDate : d.scheduledDate + "T00:00:00").getTime();
          return Math.abs(dt - ts) <= 6 * 60 * 60 * 1000; // ±6h
        }) ?? null;
      }
    }
    if (draft) {
      await (prisma as any).scriptDraft.update({ where: { id: draft.id }, data: { status: "posted", ...(zernioPostId && !draft.zernioPostId ? { zernioPostId } : {}) } });

      // It's LIVE on Instagram now → purge the raw clips + finished cut from our storage so
      // Cloudinary/R2 don't pile up (this is what maxed out Cloudinary's free plan). We clear
      // the fields too so the UI doesn't show dead links. Best-effort; never blocks the webhook.
      // ONLY on a definitive (stored-id) match: a caption or time-window match is a guess, and
      // this delete is irreversible.
      if (definitive) {
        try {
          const rawUrls: string[] = JSON.parse(draft.rawContentUrls || "[]");
          const removed = await deletePostedMedia([...rawUrls, draft.editedVideoUrl]);
          await (prisma as any).scriptDraft.update({
            where: { id: draft.id },
            data: { rawContentUrls: "[]", editedVideoUrl: null },
          });
          console.log(`[zernio-webhook] media cleanup for draft ${draft.id}: removed ${removed}/${rawUrls.length + (draft.editedVideoUrl ? 1 : 0)} files`);
        } catch (e) {
          console.error("[zernio-webhook] media cleanup failed for draft", draft.id, e);
        }
      } else {
        console.log(`[zernio-webhook] draft ${draft.id} marked posted by fallback match — media kept (no stored zernioPostId)`);
      }

      const cLabel = conceptLabelOf(draft);
      const permalink = post.permalink ?? igPlatform?.permalink ?? igPlatform?.url ?? null;
      const link = permalink || draft.editedVideoUrl || (process.env.APP_URL || "https://www.ordoagency.com");
      sendWhatsApp(`✅ LIVE on Instagram: "${draft.title}"${cLabel ? ` (${cLabel})` : ""}\n🔗 ${link}`).catch(() => {});
      logActivity({ clientId: draft.clientId, actor: "System", type: "posted", title: draft.title, detail: cLabel || "live on Instagram", draftId: draft.id });
    }
  } catch (err) {
    console.error("[zernio-webhook] handlePublished error:", err);
  }
}

async function handleFailed(body: any) {
  try {
    const post = body.post ?? body.data ?? body;
    console.error("[zernio-webhook] post FAILED:", post._id ?? post.id, post.failureReason ?? post.error);
    // Optionally: revert status back to "scheduled" so user knows to retry
    const zernioPostId = String(post._id ?? post.id ?? "");
    if (zernioPostId) {
      const piece = await (prisma as any).contentPiece.findFirst({ where: { zernioPostId } });
      if (piece) {
        await (prisma as any).contentPiece.update({
          where: { id: piece.id },
          data: { status: "edited" }, // back to pre-scheduled so user retries
        });
      }
      const draft = await (prisma as any).scriptDraft.findFirst({ where: { zernioPostId } });
      if (draft) sendWhatsApp(`⚠️ Post FAILED on Instagram: "${draft.title}" — check Zernio.`).catch(() => {});
    }
  } catch (err) {
    console.error("[zernio-webhook] handleFailed error:", err);
  }
}
