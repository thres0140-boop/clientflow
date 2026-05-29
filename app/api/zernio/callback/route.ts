import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ordoagency.com";

// GET /api/zernio/callback?clientId=X&account_id=Y (or accountId=Y)
// Zernio redirects here after the user connects Instagram.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId  = searchParams.get("clientId");
  // Zernio may pass the account id under different param names
  const accountId = searchParams.get("account_id") || searchParams.get("accountId") || searchParams.get("id");

  if (!clientId) {
    return NextResponse.redirect(`${APP_URL}/?zernio=failed&reason=no_client`);
  }

  if (!accountId) {
    console.error("[zernio/callback] No accountId in params:", Object.fromEntries(searchParams.entries()));
    return NextResponse.redirect(`${APP_URL}/?zernio=failed&reason=no_account_id&clientId=${clientId}`);
  }

  const cid = parseInt(clientId);

  await prisma.instagramConnection.upsert({
    where:  { clientId: cid },
    create: { clientId: cid, accessToken: "", igUserId: "", zernioAccountId: accountId },
    update: { zernioAccountId: accountId },
  });

  return NextResponse.redirect(`${APP_URL}/?zernio=connected&clientId=${clientId}`);
}
