import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

// POST /api/blob/upload — client-upload token endpoint for Vercel Blob.
// Used for large videos (>95MB) that exceed Cloudinary's limit. The browser uploads
// directly to Blob; this only issues a short-lived upload token (auth-gated) and
// receives the completion callback.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Only a logged-in user (owner or member) may upload.
        const token = req.cookies.get("cf_session")?.value;
        const session = token ? await verifySessionToken(token) : null;
        if (!session) throw new Error("Not authorized");
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/*"],
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024, // 2 GB
        };
      },
      onUploadCompleted: async () => { /* URL is returned to the client directly */ },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
