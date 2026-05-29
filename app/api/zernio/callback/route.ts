import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;
const APP_URL     = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ordoagency.com";

// GET /api/zernio/callback?clientId=X&accountId=Y  (or account_id=Y or id=Y)
// Zernio redirects here after the user connects Instagram via their OAuth flow.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.redirect(`${APP_URL}/?zernio=failed&reason=no_client`);
  }

  // Zernio may pass the account id under various param names
  let accountId = searchParams.get("accountId") || searchParams.get("account_id") || searchParams.get("id");

  // Fallback: if Zernio didn't pass an accountId directly, fetch the most recently
  // added account from the profile — it will be the one just connected.
  if (!accountId) {
    try {
      const res = await fetch(
        `${ZERNIO_BASE}/accounts?profileId=${PROFILE_ID}&platform=instagram`,
        { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } }
      );
      const data = await res.json();
      const accounts: any[] = data.accounts ?? [];
      if (accounts.length > 0) {
        // Sort by createdAt descending and pick the newest
        accounts.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        accountId = accounts[0]._id ?? accounts[0].id;
      }
    } catch (err) {
      console.error("[zernio/callback] Failed to fetch accounts:", err);
    }
  }

  if (!accountId) {
    console.error("[zernio/callback] No accountId found. Params:", Object.fromEntries(searchParams.entries()));
    return NextResponse.redirect(
      `${APP_URL}/?zernio=failed&reason=no_account_id&clientId=${clientId}`
    );
  }

  const cid = parseInt(clientId);
  await prisma.instagramConnection.upsert({
    where:  { clientId: cid },
    create: { clientId: cid, accessToken: "", igUserId: "", zernioAccountId: accountId },
    update: { zernioAccountId: accountId },
  });

  return NextResponse.redirect(`${APP_URL}/?zernio=connected&clientId=${clientId}`);
}
