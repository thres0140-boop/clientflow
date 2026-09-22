import type { NextConfig } from "next";

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
