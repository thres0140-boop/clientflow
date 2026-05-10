import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const draftId = parseInt(req.nextUrl.searchParams.get("draftId") || "0");
  const reviews = await prisma.draftReview.findMany({ where: { draftId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(reviews);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { draftId, reviewerName, reviewerId, status, comment } = body;

  const existing = await prisma.draftReview.findFirst({
    where: { draftId: parseInt(draftId), reviewerName },
  });

  let review;
  if (existing) {
    review = await prisma.draftReview.update({
      where: { id: existing.id },
      data: { status, comment: comment || null },
    });
  } else {
    review = await prisma.draftReview.create({
      data: {
        draftId: parseInt(draftId),
        reviewerName,
        reviewerId: reviewerId ? parseInt(reviewerId) : null,
        status,
        comment: comment || null,
      },
    });
  }

  // If "bad", also create a draft note so it shows up in the notes section
  if (status === "bad" && comment) {
    await prisma.draftNote.create({
      data: {
        draftId: parseInt(draftId),
        author: reviewerName,
        content: `❌ Rejected: ${comment}`,
      },
    });
  }

  return NextResponse.json(review);
}
