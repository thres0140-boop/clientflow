import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/ai/shared/auth/cookie";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
