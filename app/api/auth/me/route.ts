import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!token) return NextResponse.json(null);
  const session = await verifySessionToken(token);
  return NextResponse.json(session);
}
