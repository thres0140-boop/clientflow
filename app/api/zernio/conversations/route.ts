import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// GET /api/zernio/conversations?clientId=X
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });

  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 200 });
  }

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  url.searchParams.set("profileId", PROFILE_ID);
  url.searchParams.set("accountId", conn.zernioAccountId);
  url.searchParams.set("platform", "instagram");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      Accept: "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? "Failed to fetch conversations" }, { status: 400 });
  }

  return NextResponse.json(data);
}
