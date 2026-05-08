import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function GET() {
  const members = await prisma.teamMember.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(members);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const isClient = body.isClient === true;

  let inviteToken: string | null = null;
  let inviteTokenExpiry: Date | null = null;
  let inviteUrl: string | null = null;

  if (isClient && body.email) {
    inviteToken = crypto.randomBytes(32).toString("hex");
    inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.headers.get("origin") || "";
    inviteUrl = `${baseUrl}/invite/${inviteToken}`;

    // Send invite email via Resend if configured
    if (process.env.RESEND_API_KEY) {
      await sendInviteEmail({
        to: body.email,
        name: body.name,
        inviteUrl,
        apiKey: process.env.RESEND_API_KEY,
        fromName: process.env.RESEND_FROM_NAME || "ClientFlow",
        fromEmail: process.env.RESEND_FROM_EMAIL || "noreply@clientflow.app",
      });
    }
  }

  const member = await prisma.teamMember.create({
    data: {
      name: body.name,
      email: body.email || null,
      role: body.role || null,
      color: body.color || "#6366f1",
      pageAccess: body.pageAccess || "all",
      ...(inviteToken ? { inviteToken, inviteTokenExpiry } : {}),
    },
  });

  return NextResponse.json({ ...member, inviteUrl }, { status: 201 });
}

async function sendInviteEmail({
  to, name, inviteUrl, apiKey, fromName, fromEmail,
}: { to: string; name: string; inviteUrl: string; apiKey: string; fromName: string; fromEmail: string }) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: `You've been invited to ClientFlow`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#6366f1">Welcome to ClientFlow, ${name}!</h2>
          <p>You've been invited to access your client portal. Click the button below to set up your password and get started.</p>
          <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Set up my account →</a>
          <p style="color:#94a3b8;font-size:13px">This link expires in 7 days. If you didn't expect this email, you can ignore it.</p>
        </div>
      `,
    }),
  });
}
