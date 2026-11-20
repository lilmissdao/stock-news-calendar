import type { NextConfig } from "next";

const commit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local").slice(0, 7);
const builtAt = new Date().toISOString().slice(0, 16) + "Z";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commit,
    NEXT_PUBLIC_BUILD_TIME: builtAt,
  },
  async headers() {
    return [
      {
        source: "/practice",
        headers: [{ key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
