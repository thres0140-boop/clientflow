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
    const envSet = ownerPassword.length > 0;
    if (!envSet) return NextResponse.json({ error: "OWNER_PASSWORD env var not set on server" }, { status: 500 });
    if (password.trim() !== ownerPassword.trim()) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const token = await createSessionToken({ type: "owner", memberId: null, name: process.env.OWNER_NAME || "Owner" });
    const res = NextResponse.json({ ok: true, type: "owner" });
    setCookie(res, token);
    return res;
  }

  // Client / team member login
  // The same email can exist on multiple projects (one record per project). Check the
  // password against ALL of them and log into the matching record; the other projects
  // are surfaced via /api/auth/me so the user can toggle between them.
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  const members = await prisma.teamMember.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    orderBy: { id: "asc" },
  });
  let member: (typeof members)[number] | null = null;
  for (const m of members) {
    if (m.passwordHash && (await bcrypt.compare(password, m.passwordHash))) { member = m; break; }
  }
  if (!member) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // All projects this person can access (every record sharing their email).
  const siblings = member.email
    ? await prisma.teamMember.findMany({ where: { email: { equals: member.email, mode: "insensitive" }, clientId: { not: null } }, select: { clientId: true } })
    : [];
  const clientIds = Array.from(new Set(siblings.map((s) => s.clientId!).concat(member.clientId ? [member.clientId] : [])));

  const token = await createSessionToken({ type: "member", memberId: member.id, name: member.name, clientId: member.clientId ?? null, clientIds });
  const res = NextResponse.json({ ok: true, type: "member", memberId: member.id });
  setCookie(res, token);
  return res;
}
