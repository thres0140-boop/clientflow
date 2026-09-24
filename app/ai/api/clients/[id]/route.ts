import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";
import { handleFromInput } from "@/ai/features/tiktok/server/scrapeTikTok";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const client = await prisma.client.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name !== undefined ? body.name : undefined,
      platform: body.platform !== undefined ? body.platform : undefined,
      profileUrl: body.profileUrl !== undefined ? (body.profileUrl || null) : undefined,
      color: body.color !== undefined ? (body.color || "#6366f1") : undefined,
      notes: body.notes !== undefined ? (body.notes || null) : undefined,
      captionStyle: body.captionStyle !== undefined ? (body.captionStyle || null) : undefined,
      captionGuidelines: body.captionGuidelines !== undefined ? (body.captionGuidelines || null) : undefined,
      dayTemplate: body.dayTemplate !== undefined ? (body.dayTemplate || null) : undefined,
      bookingLink: body.bookingLink !== undefined ? (body.bookingLink || null) : undefined,
      scriptRules: body.scriptRules !== undefined ? (body.scriptRules || null) : undefined,
      ctaKeyword: body.ctaKeyword !== undefined ? (body.ctaKeyword || null) : undefined,
      isTestAccount: body.isTestAccount !== undefined ? body.isTestAccount === true : undefined,
      hideFromHq: body.hideFromHq !== undefined ? body.hideFromHq === true : undefined,
      instagramEnabled: body.instagramEnabled !== undefined ? body.instagramEnabled === true : undefined,
      tiktokEnabled: body.tiktokEnabled !== undefined ? body.tiktokEnabled === true : undefined,
      tiktokHandle: body.tiktokHandle !== undefined ? (handleFromInput(String(body.tiktokHandle)) || null) : undefined,
      workspaceId: body.workspaceId !== undefined ? (body.workspaceId != null ? parseInt(String(body.workspaceId)) : null) : undefined,
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
