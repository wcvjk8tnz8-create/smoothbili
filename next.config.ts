import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // B 站封面 / 头像统一走 /api/img 代理，不使用 next/image 优化
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
