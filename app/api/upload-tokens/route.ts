import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

// POST /api/upload-tokens — create or return existing token for a draft
export async function POST(req: NextRequest) {
  const { draftId } = await req.json();
  if (!draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const draft = await prisma.scriptDraft.findUnique({ where: { id: parseInt(draftId) } });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  // Reuse existing token if already set
  if (draft.uploadToken) {
    return NextResponse.json({ token: draft.uploadToken });
  }

  const token = randomBytes(16).toString("hex");
  await prisma.scriptDraft.update({
    where: { id: draft.id },
    data: { uploadToken: token },
  });

  return NextResponse.json({ token });
}
