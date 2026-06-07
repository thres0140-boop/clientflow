import { completeMultipartUpload } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

// POST /api/blob/mpu/complete — finalize the multipart upload, return the public URL.
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && await verifySessionToken(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { pathname, key, uploadId, parts } = await req.json();
  if (!pathname || !key || !uploadId || !Array.isArray(parts)) return NextResponse.json({ error: "missing params" }, { status: 400 });
  try {
    const blob = await completeMultipartUpload(pathname, parts, { access: "public", key, uploadId });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
