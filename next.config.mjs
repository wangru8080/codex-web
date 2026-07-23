/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.3.12"],
  outputFileTracingIncludes: {
    "/*": ["./themes/**/*.json"],
  },
};

export default nextConfig;
