import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone for the Docker image (and later
  // local desktop bundles). The local launcher uses this server directly.
  output: "standalone",
  // ReadyState has no image-optimizer consumers; serve future images as-is.
  images: { unoptimized: true },
  // Next still traces its disabled optimizer. Exclude only that unused stack.
  outputFileTracingExcludes: {
    "**": ["node_modules/sharp/**/*", "node_modules/@img/sharp*/**/*"],
  },
  cacheComponents: true,
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
