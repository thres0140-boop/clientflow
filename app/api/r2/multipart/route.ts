import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

// Multipart upload to R2 so large videos go up as small, independently-retried parts
// (a single giant PUT gets killed by some AV/firewall/flaky-uplink setups).
//   POST { action: "create", filename, contentType }            -> { uploadId, key, publicUrl }
//   POST { action: "sign",   key, uploadId, partNumber }         -> { url }
//   POST { action: "complete", key, uploadId, parts: [...] }     -> { publicUrl }
//   POST { action: "abort",  key, uploadId }                     -> { ok }
function s3() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && (await verifySessionToken(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bucket = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!process.env.R2_ACCOUNT_ID || !bucket || !publicBase) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  }

  const body = await req.json();
  const action = body.action;
  try {
    const client = s3();
    if (action === "create") {
      const safe = String(body.filename || "video.mp4").replace(/[^\w.\-]+/g, "_");
      const key = `videos/${Date.now()}-${safe}`;
      const out = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: body.contentType || "video/mp4" }));
      return NextResponse.json({ uploadId: out.UploadId, key, publicUrl: `${publicBase.replace(/\/$/, "")}/${key}` });
    }
    if (action === "sign") {
      const url = await getSignedUrl(client, new UploadPartCommand({ Bucket: bucket, Key: body.key, UploadId: body.uploadId, PartNumber: body.partNumber }), { expiresIn: 3600 });
      return NextResponse.json({ url });
    }
    if (action === "complete") {
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket, Key: body.key, UploadId: body.uploadId,
        MultipartUpload: { Parts: body.parts },
      }));
      return NextResponse.json({ publicUrl: `${publicBase.replace(/\/$/, "")}/${body.key}` });
    }
    if (action === "abort") {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: body.key, UploadId: body.uploadId })).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
