import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/vid?u=<encoded video url> — server-side video proxy. Instagram CDN videos
// can't be hot-linked from the browser (403 / cross-origin), so we stream them here and
// forward HTTP Range requests so the <video> element can seek. Used to play candidate
// reels inline in the preview modal.
export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u || !/^https?:\/\//.test(u)) return new NextResponse("bad url", { status: 400 });
  const range = req.headers.get("range") || undefined;
  try {
    const r = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "video/*,*/*",
        ...(range ? { Range: range } : {}),
      },
    });
    if (!r.ok && r.status !== 206) return new NextResponse("not found", { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", r.headers.get("content-type") || "video/mp4");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=3600");
    const len = r.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const cr = r.headers.get("content-range");
    if (cr) headers.set("Content-Range", cr);
    return new NextResponse(r.body, { status: r.status, headers });
  } catch {
    return new NextResponse("error", { status: 500 });
  }
}
