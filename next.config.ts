import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/clips/[id]/render": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
