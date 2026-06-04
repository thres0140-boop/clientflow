import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/notify";

// POST /api/webhooks/zernio
// Receives Zernio webhook events for post.published, post.failed, post.scheduled
// Zernio sends X-Zernio-Signature header if a secret key is configured.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
      const cLabel = conceptLabelOf(draft);
      const permalink = post.permalink ?? igPlatform?.permalink ?? igPlatform?.url ?? null;
      const link = permalink || draft.editedVideoUrl || (process.env.APP_URL || "https://www.ordoagency.com");
      sendWhatsApp(`✅ LIVE on Instagram: "${draft.title}"${cLabel ? ` (${cLabel})` : ""}\n🔗 ${link}`).catch(() => {});
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
