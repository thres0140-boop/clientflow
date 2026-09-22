import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/features/tiktok/server/tiktokOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/tiktok/callback?code=&state= — TikTok redirects here after the user authorizes.
// We validate state (CSRF), exchange the code for tokens, attach them to the client, and bounce back.
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const err = url.searchParams.get("error");
  const home = new URL("/", url.origin);

  if (err) { home.searchParams.set("tiktok_error", err); return NextResponse.redirect(home); }
  if (!code || !state) { home.searchParams.set("tiktok_error", "missing_code"); return NextResponse.redirect(home); }

  const cookieState = req.cookies.get("tt_oauth_state")?.value;
  if (cookieState && cookieState !== state) { home.searchParams.set("tiktok_error", "state_mismatch"); return NextResponse.redirect(home); }

  const clientId = parseInt(state.split(".")[0]);
  if (!clientId) { home.searchParams.set("tiktok_error", "bad_state"); return NextResponse.redirect(home); }

  try {
    const t = await exchangeCode(code);
    if (!t.access_token) { home.searchParams.set("tiktok_error", t.error || "token_failed"); return NextResponse.redirect(home); }
    await saveTokens(clientId, t);
    home.searchParams.set("tiktok_connected", "1");
  } catch (e) {
    home.searchParams.set("tiktok_error", e instanceof Error ? e.message : "callback_failed");
  }
  const res = NextResponse.redirect(home);
  res.cookies.delete("tt_oauth_state");
  return res;
}
