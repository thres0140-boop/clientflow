import { ImageResponse } from "next/og";

export const runtime = "nodejs";

// Generates a square ORDO app icon at the requested size (used by the PWA manifest +
// apple-touch-icon). e.g. /icons/192 , /icons/512 , /icons/180
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const raw = parseInt((await params).size) || 512;
  const size = Math.min(1024, Math.max(48, raw));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        }}
      >
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="white">
          <path d="M2.5 7.2 L7 11 L12 3.5 L17 11 L21.5 7.2 L20 18.5 H4 Z" />
          <rect x="4" y="19.4" width="16" height="2.2" rx="1.1" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
