import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { deletePostedMedia } from "@/shared/media/mediaCleanup";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/admin/purge-cloudinary?token=zernio-migrate-2024
// One-time backlog cleaner. Cloudinary's dashboard is locked while the account is over its
// free limit, but the Admin API still deletes — so this deletes media for ALREADY-POSTED
// drafts (safe: nothing in the active pipeline is touched) to free space.
//   &dry=1   → just count, delete nothing
//   &limit=N → cap how many drafts to process this run (default 250)
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token");
  if (secret !== "zernio-migrate-2024") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "250") || 250;

  const hasCreds = !!(
    (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME) &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

  const drafts = await (prisma as any).scriptDraft.findMany({
    where: { status: "posted" },
    select: { id: true, rawContentUrls: true, editedVideoUrl: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  // Collect every media URL attached to a posted draft.
  let urls: string[] = [];
  for (const d of drafts) {
    let raw: string[] = [];
    try { raw = JSON.parse(d.rawContentUrls || "[]"); } catch { raw = []; }
    urls.push(...raw, ...(d.editedVideoUrl ? [d.editedVideoUrl] : []));
  }
  urls = urls.filter(Boolean);
  const cloudinaryCount = urls.filter((u) => /cloudinary\.com/.test(u)).length;
  const r2Count = urls.filter((u) => /r2\.dev|r2\.cloudflarestorage|\.r2\./.test(u)).length;

  if (dry) {
    return NextResponse.json({
      dryRun: true, postedDrafts: drafts.length, mediaUrls: urls.length,
      cloudinaryCount, r2Count, hasCloudinaryCreds: hasCreds,
    });
  }

  if (!hasCreds && cloudinaryCount > 0) {
    return NextResponse.json({
      error: "Cloudinary API credentials missing — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Vercel.",
      postedDrafts: drafts.length, mediaUrls: urls.length, cloudinaryCount, r2Count,
    }, { status: 400 });
  }

  const deleted = await deletePostedMedia(urls);

  // Clear the now-dead links so the UI doesn't show broken media.
  await (prisma as any).scriptDraft.updateMany({
    where: { id: { in: drafts.map((d: any) => d.id) } },
    data: { rawContentUrls: "[]", editedVideoUrl: null },
  });

  return NextResponse.json({
    ok: true, postedDrafts: drafts.length, mediaUrls: urls.length,
    deleted, cloudinaryCount, r2Count,
  });
}
