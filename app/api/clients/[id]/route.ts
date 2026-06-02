import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const client = await prisma.client.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name,
      platform: body.platform,
      profileUrl: body.profileUrl || null,
      color: body.color || "#6366f1",
      notes: body.notes || null,
      captionStyle: body.captionStyle !== undefined ? (body.captionStyle || null) : undefined,
      dayTemplate: body.dayTemplate !== undefined ? (body.dayTemplate || null) : undefined,
      bookingLink: body.bookingLink !== undefined ? (body.bookingLink || null) : undefined,
      scriptRules: body.scriptRules !== undefined ? (body.scriptRules || null) : undefined,
      ctaKeyword: body.ctaKeyword !== undefined ? (body.ctaKeyword || null) : undefined,
      isTestAccount: body.isTestAccount !== undefined ? body.isTestAccount === true : undefined,
    } as any,
  });
  return NextResponse.json(client);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.client.delete({ where: { id: parseInt(id) } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[DELETE client]", err);
    return NextResponse.json({ error: err?.message ?? "Delete failed" }, { status: 500 });
  }
}
