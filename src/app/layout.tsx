import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "SmoothBili · 哔哩滑滑 Biliboli",
    template: "%s · SmoothBili",
  },
  description:
    "SmoothBili（哔哩滑滑 Biliboli）：无广告、不追踪、非盈利的第三方哔哩哔哩 Web 客户端。支持搜索、播放、弹幕、登录与更高画质。",
  applicationName: "SmoothBili",
  keywords: [
    "哔哩哔哩",
    "bilibili",
    "B站",
    "第三方客户端",
    "无广告",
    "SmoothBili",
    "哔哩滑滑",
    "Biliboli",
  ],
  openGraph: {
    title: "SmoothBili · 哔哩滑滑 Biliboli",
    description: "无广告、不追踪、非盈利的第三方 B 站 Web 客户端",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#17181a" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Nav />
        <main className="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
