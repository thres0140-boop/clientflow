import { NextRequest, NextResponse } from "next/server";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;

// DELETE /api/zernio/posts/[postId] — cancel/delete a scheduled post in Zernio
export async function DELETE(req: NextRequest, { params }: { params: { postId: string } }) {
  const { postId } = params;
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  const res = await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.warn("[zernio/posts] delete failed:", res.status, data);
    // Don't fail hard — post might already be gone
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/zernio/posts/[postId] — update scheduled time
export async function PATCH(req: NextRequest, { params }: { params: { postId: string } }) {
  const { postId } = params;
  const { scheduledFor } = await req.json();
  if (!postId || !scheduledFor) return NextResponse.json({ error: "postId and scheduledFor required" }, { status: 400 });

  const res = await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ scheduledFor, timezone: "Europe/Amsterdam" }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[zernio/posts] patch failed:", res.status, data);
    return NextResponse.json({ error: data?.message ?? "Failed to update" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data });
}
