import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  logging: {
    incomingRequests: {
      ignore: [/^\/api\/accounts\/(instagram|youtube|linkedin)\/callback(?:\?|$)/],
    },
  },
  outputFileTracingExcludes: { "/*": ["./.data/**/*", "./.env*"] },
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "ffprobe-static",
    "sharp",
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@aws-sdk/s3-request-presigner",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
