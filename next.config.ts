import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["showcase.wildan.lol"],
};

export default nextConfig;
