import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";

export const runtime = "nodejs";

// POST /api/upload-tokens/[token]/presign — public, token-gated presigned PUT to R2 so the
// person who scanned the QR (no login) can upload a raw clip straight to Cloudflare R2.
// Cloudinary is dead (cloud disabled), so the QR flow now goes to R2 like everything else.
// Body: { filename, contentType }. Returns { uploadUrl, publicUrl }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const draft = await prisma.scriptDraft.findUnique({ where: { uploadToken: token }, select: { id: true } });
  if (!draft) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  }

  const { filename, contentType } = await req.json();
  const safe = String(filename || "clip.mp4").replace(/[^\w.\-]+/g, "_");
  const key = `videos/${Date.now()}-${safe}`;

  try {
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType || "video/mp4" }),
      { expiresIn: 3600 }
    );
    return NextResponse.json({ uploadUrl, publicUrl: `${publicBase.replace(/\/$/, "")}/${key}`, key });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
