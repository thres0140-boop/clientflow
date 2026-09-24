import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";
import { canEditPage } from "@/ai/shared/auth/permissions";
import { isPlatformId, type PlatformId } from "@/shared/platforms";

const ZERNIO_BASE = `https://zernio.com/api/v1`;
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.AI_ZERNIO_PROFILE_ID!;

// Resolve the Zernio account + profile a client uses for a given platform.
//   instagram → InstagramConnection.zernioAccountId / .zernioProfileId
//   tiktok    → Client.tiktokZernioAccountId / .tiktokZernioProfileId
async function zernioAccountFor(clientId: number, platform: PlatformId): Promise<{ accountId: string; profileId: string } | null> {
  if (platform === "instagram") {
    const conn = await prisma.instagramConnection.findUnique({ where: { clientId } });
    if (!conn?.zernioAccountId) return null;
    return { accountId: conn.zernioAccountId, profileId: conn.zernioProfileId || PROFILE_ID };
  }
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { tiktokZernioAccountId: true, tiktokZernioProfileId: true },
  });
  if (!client?.tiktokZernioAccountId) return null;
  return { accountId: client.tiktokZernioAccountId, profileId: client.tiktokZernioProfileId || PROFILE_ID };
}

// POST /api/zernio/schedule
// Body: { clientId, content, mediaUrls?, scheduledFor?, platform? = "instagram", trialReel?, contentPieceId?, scriptDraftId? }
// Schedules (or publishes immediately) a post via Zernio on the given platform, using the Zernio
// account the client has linked for that platform.
export async function POST(req: NextRequest) {
  // Posting/scheduling is a Content-Scheduling edit action — block view-only members.
  if (!(await canEditPage(req, "pipeline"))) {
    return NextResponse.json({ error: "You have view-only access to Content Scheduling." }, { status: 403 });
  }

  // GATE: no AI-side publish path may exist until this product's own Zernio webhook is
  // registered (profile-scoped + signed). Until then a publish event would reach the agency
  // webhook. Flip AI_PUBLISHING_ENABLED=1 only after /ai/api/webhooks/zernio is registered.
  if (process.env.AI_PUBLISHING_ENABLED !== "1") {
    return NextResponse.json({ error: "publishing_disabled", message: "Publishing from the AI product is disabled until its Zernio webhook is registered." }, { status: 503 });
  }

  const { clientId, content, mediaUrls, scheduledFor, contentPieceId, scriptDraftId, trialReel, platform: platformRaw } = await req.json();

  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  // Platform defaults to Instagram so existing callers behave exactly as before.
  const platform: PlatformId = platformRaw == null ? "instagram" : platformRaw;
  if (!isPlatformId(platform)) {
    return NextResponse.json({ error: "unsupported_platform", message: `Unsupported platform "${String(platformRaw)}"` }, { status: 400 });
  }

  const account = await zernioAccountFor(parseInt(clientId), platform);
  if (!account) {
    return NextResponse.json({
      error: "no_zernio_account",
      platform,
      message: `No Zernio ${platform === "tiktok" ? "TikTok" : "Instagram"} account is linked for this client.`,
    }, { status: 400 });
  }

  // Trial reel: Instagram shows it only to non-followers first, then auto-graduates
  // to followers if it performs well (SS_PERFORMANCE). Instagram video reels only.
  const platformSpecificData = platform === "instagram" && trialReel === true
    ? { contentType: "reels", trialParams: { graduationStrategy: "SS_PERFORMANCE" } }
    : undefined;

  const body: Record<string, unknown> = {
    profileId: account.profileId,
    content,
    platforms: [{
      platform,
      accountId: account.accountId,
      ...(platformSpecificData ? { platformSpecificData } : {}),
    }],
  };

  if (mediaUrls && mediaUrls.length > 0) {
    body.mediaItems = mediaUrls.map((url: string) => ({ url }));
  }

  if (scheduledFor) {
    const scheduledDate = new Date(scheduledFor);
    const isNow = scheduledDate.getTime() - Date.now() < 60_000; // within 1 min = post now
    if (isNow) {
      body.publishNow = true;
    } else {
      // scheduledFor must be in UTC ISO 8601 — Zernio interprets it in the given timezone
      body.scheduledFor = scheduledFor;
      body.timezone     = "Europe/Amsterdam"; // TODO: make per-client if needed
    }
  } else {
    // No time given — publish now
    body.publishNow = true;
  }

  console.log("[zernio/schedule] sending body:", JSON.stringify(body));

  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("[zernio/schedule] response", res.status, JSON.stringify(data));

  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? data?.error ?? "Failed to post", raw: data }, { status: 400 });
  }

  // Save zernioPostId — Zernio returns _id (MongoDB style), sometimes wrapped in { post }.
  const zernioPostId = data?._id ?? data?.id ?? data?.post?._id ?? data?.post?.id ?? null;
  if (zernioPostId && contentPieceId) {
    await (prisma as any).contentPiece.update({
      where: { id: parseInt(contentPieceId) },
      data: { zernioPostId: String(zernioPostId) },
    }).catch(() => {/* ignore */});
  }
  // Store it on the script draft too, so the post.published webhook can flip the
  // calendar card to "posted" (green) when Zernio actually publishes it.
  if (zernioPostId && scriptDraftId) {
    await (prisma as any).scriptDraft.update({
      where: { id: parseInt(scriptDraftId) },
      data: { zernioPostId: String(zernioPostId) },
    }).catch(() => {/* ignore */});
  }

  return NextResponse.json({ ...data, zernioPostId });
}
