import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/shared/auth/session";

export const runtime = "nodejs";

// GET /api/r2/sign-get?url=<public R2 url> — a short-lived presigned GET for one of our own R2
// objects, on the S3 endpoint (<account>.r2.cloudflarestorage.com) rather than the public
// r2.dev domain. The editor plays media through this instead of the /api/vid proxy: r2.dev is
// rate-limited and not meant for production traffic, but the S3 endpoint is not, and a 4K
// clip streamed through a function body stalls playback. The bucket's CORS rules already
// allow GET/HEAD from the app's origins (see /api/r2/setup-cors), so <video crossorigin>
// works and the editor can still draw a poster frame. Returns { url, expiresAt }.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && (await verifySessionToken(token)))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_BUCKET;
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  const url = req.nextUrl.searchParams.get("url") || "";
  if (!url.startsWith(publicBase + "/")) return NextResponse.json({ error: "not an R2 url" }, { status: 400 });
  const key = decodeURIComponent(url.slice(publicBase.length + 1).split("?")[0]);
  if (!key || key.includes("..")) return NextResponse.json({ error: "bad key" }, { status: 400 });
  try {
    const s3 = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
    const expiresIn = 3600;
    const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    return NextResponse.json({ url: signed, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
