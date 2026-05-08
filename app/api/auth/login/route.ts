import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createSessionToken } from "@/lib/session";

function setCookie(res: NextResponse, token: string) {
  res.cookies.set("cf_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password, ownerOnly } = body as { email?: string; password: string; ownerOnly?: boolean };

  const ownerEmail = process.env.OWNER_EMAIL || "";
  const ownerPassword = process.env.OWNER_PASSWORD || "";

  // Owner login — only via /owner page (ownerOnly flag required)
  if (ownerOnly) {
    if (password !== ownerPassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const token = await createSessionToken({ type: "owner", memberId: null, name: process.env.OWNER_NAME || "Owner" });
    const res = NextResponse.json({ ok: true, type: "owner" });
    setCookie(res, token);
    return res;
  }

  // Client / team member login
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  const member = await prisma.teamMember.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!member || !member.passwordHash) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const valid = await bcrypt.compare(password, member.passwordHash);
  if (!valid) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  const token = await createSessionToken({ type: "member", memberId: member.id, name: member.name });
  const res = NextResponse.json({ ok: true, type: "member", memberId: member.id });
  setCookie(res, token);
  return res;
}
