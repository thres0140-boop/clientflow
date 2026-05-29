import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// Allow large video uploads (up to 500 MB)
export const maxDuration = 60;

// POST /api/upload-raw — stores file in Vercel Blob with zero re-encoding.
// Returns { url } pointing to the original file bytes.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const filename = (form.get("filename") as string) || file?.name || "upload";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const blob = await put(`ig-posts/${Date.now()}-${filename}`, buffer, {
    access: "public",
    contentType: file.type || "application/octet-stream",
    // No transformations — raw bytes only
    addRandomSuffix: true,
  });

  return NextResponse.json({ url: blob.url });
}
