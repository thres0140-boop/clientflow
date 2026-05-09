import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — Unipile redirects here after hosted auth
// Query params: clientId, status (success|failure), account_id (on success)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId  = searchParams.get("clientId");
  const status    = searchParams.get("status");
  const accountId = searchParams.get("account_id");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://clientflow-ten.vercel.app";

  if (status !== "success" || !clientId || !accountId) {
    return NextResponse.redirect(`${appUrl}/?unipile=failed`);
  }

  await prisma.instagramConnection.upsert({
    where: { clientId: parseInt(clientId) },
    create: {
      clientId: parseInt(clientId),
      accessToken: "",
      igUserId: "",
      unipileAccountId: accountId,
    },
    update: { unipileAccountId: accountId },
  });

  return NextResponse.redirect(`${appUrl}/?unipile=connected&clientId=${clientId}`);
}
