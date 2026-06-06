import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";
import { googleAuthUrl } from "@/lib/googleDrive";

// GET /api/google/auth — owner-only: redirect to Google's consent screen.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.type !== "owner") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID not set on the server." }, { status: 500 });
  }
  return NextResponse.redirect(googleAuthUrl("ordo"));
}
