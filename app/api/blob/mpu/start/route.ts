import { createMultipartUpload } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

// POST /api/blob/mpu/start — begin a server-side multipart upload to Vercel Blob.
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && await verifySessionToken(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { pathname, contentType } = await req.json();
  if (!pathname) return NextResponse.json({ error: "pathname required" }, { status: 400 });
  try {
    const mpu = await createMultipartUpload(pathname, { access: "public", contentType: contentType || undefined });
    return NextResponse.json({ key: mpu.key, uploadId: mpu.uploadId, pathname });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
