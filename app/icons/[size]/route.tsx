import { ImageResponse } from "next/og";

export const runtime = "nodejs";
// Cache aggressively — the icon rarely changes and rendering fetches a font.
export const revalidate = 86400;

const NAVY = "#16324f";   // ORDO wordmark navy
const CREAM = "#f4f3ef";  // ORDO logo background

// Load a geometric bold font (Poppins) so the wordmark matches the logo's rounded letterforms.
// Satori needs real font data to render text; woff is supported.
async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@fontsource/poppins@5.0.14/files/poppins-latin-700-normal.woff", { cache: "force-cache" });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch { return null; }
}

// Generates a square ORDO app icon at the requested size (PWA manifest + apple-touch-icon).
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const raw = parseInt((await params).size) || 512;
  const size = Math.min(1024, Math.max(48, raw));
  const font = await loadFont();

  if (font) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: CREAM }}>
          <div style={{ fontFamily: "Poppins", fontWeight: 700, fontSize: size * 0.27, color: NAVY, letterSpacing: `${-size * 0.004}px` }}>
            ORDO
          </div>
        </div>
      ),
      { width: size, height: size, fonts: [{ name: "Poppins", data: font, weight: 700, style: "normal" }] }
    );
  }

  // Font fetch failed — fall back to a clean navy "O" drawn as vectors (no font needed).
  const r = size * 0.3, sw = size * 0.11;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: CREAM }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={NAVY} strokeWidth={sw} />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
