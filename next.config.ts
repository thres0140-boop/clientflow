import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors fail the build. This is the safety net for refactors: `tsc` catches
  // every broken import, so a file move is verified rather than hoped for.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
