import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lobsterpay/shared"],
};

export default nextConfig;
