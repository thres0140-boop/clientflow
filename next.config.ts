import type { NextConfig } from "next";
import { AI_SLUG } from "./ai/slug";

// Origins allowed to embed Ordo in an iframe (the Cenks Dashboard). Extend in production by
// setting EMBED_ALLOWED_ORIGINS="https://dashboard.example.com,https://other.example.com".
// Nothing else may frame the app: frame-ancestors replaces X-Frame-Options.
const embedOrigins = [
  "http://localhost:3000",
  ...(process.env.EMBED_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

const nextConfig: NextConfig = {
  // Type errors fail the build. This is the safety net for refactors: `tsc` catches
  // every broken import, so a file move is verified rather than hoped for.
  typescript: { ignoreBuildErrors: false },
  // The video editor's auto-captions route and Clipping's transcription route extract audio with
  // ffmpeg-static. The binary is not discoverable by file tracing (the package resolves it from
  // __dirname), so include it for those two routes and keep the package external so it is
  // required at runtime, not bundled.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/edit-projects/[id]/transcribe": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/edit-projects/[id]/waveform": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/edit-projects/[id]/filmstrip": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/clipping/transcribe": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/clipping/bench": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // The AI product physically lives under app/ai. If its slug is ever changed in ai/slug.ts,
  // this rewrite maps the new public prefix onto that folder — no files move.
  async rewrites() {
    if (AI_SLUG === "ai") return [];
    return [{ source: `/${AI_SLUG}/:path*`, destination: "/ai/:path*" }, { source: `/${AI_SLUG}`, destination: "/ai" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${embedOrigins.join(" ")}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
