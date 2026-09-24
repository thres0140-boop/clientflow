import { NextRequest, NextResponse } from "next/server";
import { tiktokAuthUrl } from "@/ai/features/tiktok/server/tiktokOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/tiktok?clientId= — kicks off TikTok Login Kit OAuth for a client. The clientId is
// carried in `state` (with a random nonce) so the callback knows which client to attach the account to.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return new NextResponse("clientId required", { status: 400 });
  const nonce = Math.random().toString(36).slice(2, 10);
  const state = `${clientId}.${nonce}`;
  const res = NextResponse.redirect(tiktokAuthUrl(state));
  // CSRF: also drop the state in a cookie the callback can compare.
  res.cookies.set("tt_ai_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
