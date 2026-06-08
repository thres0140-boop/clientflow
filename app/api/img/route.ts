import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/img?u=<encoded image url> — server-side image proxy. Instagram CDN images
// can't be hot-linked from the browser (they fail cross-origin), so we fetch them here
// and stream them back. Used for competitor/candidate profile pictures.
export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u || !/^https?:\/\//.test(u)) return new NextResponse("bad url", { status: 400 });
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" } });
    if (!r.ok) return new NextResponse("not found", { status: 404 });
    const buf = Buffer.from(await r.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new NextResponse("error", { status: 500 });
  }
}
