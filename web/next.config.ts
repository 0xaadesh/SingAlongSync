import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  // Proxy backend through the Next server so a single tunnel (e.g. ngrok on :3000) serves both.
  async rewrites() {
    const backend = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";
    return ["/api", "/downloads", "/media/avatars"].map((prefix) => ({
      source: `${prefix}/:path*`,
      destination: `${backend}${prefix}/:path*`,
    }));
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
