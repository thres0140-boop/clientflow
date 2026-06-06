import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { exchangeCode } from "@/lib/googleDrive";

// GET /api/google/callback — Google redirects here with ?code. Store the refresh token.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.type !== "owner") return NextResponse.redirect(new URL("/", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const err = req.nextUrl.searchParams.get("error");
  if (err || !code) return NextResponse.redirect(new URL("/?google=failed", req.url));

  try {
    const { refreshToken, email } = await exchangeCode(code);
    if (refreshToken) {
      await (prisma as any).googleAuth.upsert({
        where: { scope: "workspace" },
        update: { refreshToken, email: email ?? null },
        create: { scope: "workspace", refreshToken, email: email ?? null },
      });
    } else {
      // Google only returns a refresh token on first consent — if we got none and have
      // no stored one, the user must revoke + reconnect. Keep any existing token.
      const existing = await (prisma as any).googleAuth.findUnique({ where: { scope: "workspace" } });
      if (!existing) return NextResponse.redirect(new URL("/?google=norefresh", req.url));
      if (email) await (prisma as any).googleAuth.update({ where: { scope: "workspace" }, data: { email } });
    }
    return NextResponse.redirect(new URL("/?google=connected", req.url));
  } catch {
    return NextResponse.redirect(new URL("/?google=failed", req.url));
  }
}
