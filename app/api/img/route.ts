import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/img?u=<encoded image url> — server-side image proxy. Instagram CDN images
// can't be hot-linked from the browser (they fail cross-origin), so we fetch them here
// and stream them back. Used for competitor/candidate profile pictures.
// A 1×1 transparent PNG — returned when the source image is gone (expired Instagram CDN
// links) so the browser shows nothing broken and doesn't spam the console with 404s.
const BLANK = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
function blank() {
  return new NextResponse(BLANK, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u || !/^https?:\/\//.test(u)) return blank();
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" } });
    if (!r.ok) return blank(); // expired/removed source → transparent placeholder, not a 404
    const buf = Buffer.from(await r.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return blank();
  }
}
