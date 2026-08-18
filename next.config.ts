import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  outputFileTracingRoot: process.cwd()
};

export default nextConfig;
