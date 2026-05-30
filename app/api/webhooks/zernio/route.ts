import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  const event = body.event ?? body.type ?? body.name;
  console.log("[zernio-webhook] event:", event, JSON.stringify(body).slice(0, 500));

  if (event === "post.published" || event === "post.platform.published") {
    await handlePublished(body);
  } else if (event === "post.failed") {
    await handleFailed(body);
  } else if (event === "post.scheduled") {
    // Just log — already marked scheduled when we created it
    console.log("[zernio-webhook] post scheduled:", body?.post?.id);
  }

  return NextResponse.json({ ok: true });
}

async function handlePublished(body: any) {
  try {
    const post = body.post ?? body.data ?? body;
    const zernioPostId = String(post.id ?? post.postId ?? "");
    // Instagram media ID may be in platforms array or directly on post
    const platforms: any[] = post.platforms ?? post.accounts ?? [];
    const igPlatform = platforms.find((p: any) =>
      (p.platform ?? p.type ?? "").toLowerCase() === "instagram"
    );
    const igMediaId: string | null = igPlatform?.platformPostId ?? igPlatform?.mediaId ?? igPlatform?.postId ?? null;

    // Match ContentPiece by zernioPostId (if stored) OR by scheduledDate proximity
    let piece: any = null;

    if (zernioPostId) {
      piece = await (prisma as any).contentPiece.findFirst({
        where: { zernioPostId },
      });
    }

    // Fallback: match by scheduledDate within ±10 minutes of post's scheduled/published time
    if (!piece) {
      const postTime = post.scheduledAt ?? post.publishedAt ?? post.scheduled_at ?? post.created_at;
      if (postTime) {
        const ts = new Date(postTime).getTime();
        const TEN_MIN = 10 * 60 * 1000;
        const candidates = await (prisma as any).contentPiece.findMany({
          where: { status: { in: ["scheduled", "edited"] }, scheduledDate: { not: null } },
        });
        piece = candidates.find((c: any) => {
          if (!c.scheduledDate) return false;
          return Math.abs(new Date(c.scheduledDate).getTime() - ts) <= TEN_MIN;
        }) ?? null;
      }
    }

    if (piece) {
      const updateData: any = { status: "posted" };
      if (igMediaId) updateData.igMediaId = igMediaId;
      await (prisma as any).contentPiece.update({
        where: { id: piece.id },
        data: updateData,
      });
      console.log(`[zernio-webhook] marked piece ${piece.id} as posted${igMediaId ? ` igMediaId=${igMediaId}` : ""}`);
    } else {
      console.log("[zernio-webhook] no matching ContentPiece found for published post");
    }
  } catch (err) {
    console.error("[zernio-webhook] handlePublished error:", err);
  }
}

async function handleFailed(body: any) {
  try {
    const post = body.post ?? body.data ?? body;
    console.error("[zernio-webhook] post FAILED:", post.id, post.failureReason ?? post.error);
    // Optionally: revert status back to "scheduled" so user knows to retry
    const zernioPostId = String(post.id ?? "");
    if (zernioPostId) {
      const piece = await (prisma as any).contentPiece.findFirst({ where: { zernioPostId } });
      if (piece) {
        await (prisma as any).contentPiece.update({
          where: { id: piece.id },
          data: { status: "edited" }, // back to pre-scheduled so user retries
        });
      }
    }
  } catch (err) {
    console.error("[zernio-webhook] handleFailed error:", err);
  }
}
