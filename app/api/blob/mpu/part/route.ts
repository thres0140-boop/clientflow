import { uploadPart } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/blob/mpu/part?pathname=&key=&uploadId=&partNumber= — body is the raw chunk
// (kept under ~4MB by the client so it fits Vercel's request limit).
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && await verifySessionToken(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = req.nextUrl.searchParams;
  const pathname = u.get("pathname");
  const key = u.get("key");
  const uploadId = u.get("uploadId");
  const partNumber = parseInt(u.get("partNumber") || "");
  if (!pathname || !key || !uploadId || !partNumber) return NextResponse.json({ error: "missing params" }, { status: 400 });
  try {
    const body = Buffer.from(await req.arrayBuffer());
    const part = await uploadPart(pathname, body, { access: "public", key, uploadId, partNumber });
    return NextResponse.json({ etag: part.etag, partNumber: part.partNumber });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
