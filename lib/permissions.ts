import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

// True if the current request is allowed to EDIT the given page (owner always can;
// a member can unless that page is in their viewOnlyPages). Server-side mirror of the
// UI's view/use gating, so a view-only member can't schedule by hitting the API directly.
export async function canEditPage(req: NextRequest, page: string): Promise<boolean> {
  try {
    const token = req.cookies.get("cf_session")?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session) return false;              // no session → no write
    if (session.type === "owner") return true;
    if (session.memberId == null) return false;
    const member = await prisma.teamMember.findUnique({
      where: { id: session.memberId },
      select: { pageAccess: true, viewOnlyPages: true } as any,
    });
    if (!member) return false;
    const access = (member as any).pageAccess as string;
    const allowed = access === "all" || access.split(",").includes(page);
    if (!allowed) return false;              // page hidden → no write
    const viewOnly = ((member as any).viewOnlyPages || "").split(",").filter(Boolean);
    return !viewOnly.includes(page);          // view-only → no write
  } catch {
    return false;
  }
}
