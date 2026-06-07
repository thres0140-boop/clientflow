import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

// POST /api/r2/presign — returns a short-lived presigned PUT URL so the browser can upload
// a large video directly to Cloudflare R2 (no Vercel request-size limit, no Blob quirks).
// Body: { filename, contentType }. Returns { uploadUrl, publicUrl }.
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && (await verifySessionToken(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL; // e.g. https://pub-xxxx.r2.dev  (no trailing slash)
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  }

  const { filename, contentType } = await req.json();
  const safe = String(filename || "video.mp4").replace(/[^\w.\-]+/g, "_");
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
      { expiresIn: 3600 } // 1 hour
    );
    return NextResponse.json({ uploadUrl, publicUrl: `${publicBase.replace(/\/$/, "")}/${key}`, key });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
