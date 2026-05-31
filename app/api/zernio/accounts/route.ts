import { NextRequest, NextResponse } from "next/server";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// GET /api/zernio/accounts
// Returns all Instagram accounts connected to this Zernio profile.
// Used so users can pick which account to link to which client.
export async function GET(req: NextRequest) {
  // Allow per-client profile ID override
  const profileId = req.nextUrl.searchParams.get("profileId") || PROFILE_ID;
  const res = await fetch(
    `${ZERNIO_BASE}/accounts?profileId=${profileId}&platform=instagram`,
    {
      headers: {
        Authorization: `Bearer ${ZERNIO_KEY}`,
        Accept: "application/json",
      },
    }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? data?.error ?? JSON.stringify(data), raw: data }, { status: 400 });
  return NextResponse.json(data);
}
