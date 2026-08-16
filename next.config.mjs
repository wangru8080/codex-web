/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.3.12"],
  experimental: {
    optimizePackageImports: [
      "@phosphor-icons/react",
      "@hugeicons/core-free-icons",
    ],
  },
  productionBrowserSourceMaps: process.env.CODEX_WEB_PROFILE_SOURCE_MAPS === "1",
  outputFileTracingIncludes: {
    "/*": ["./themes/**/*.json"],
  },
};

export default nextConfig;
