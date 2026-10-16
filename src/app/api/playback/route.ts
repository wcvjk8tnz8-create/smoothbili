/**
 * 视频 / 音频流代理。
 *
 * 必须代理的原因：B 站 CDN 校验 Referer，浏览器直连会 403。
 * 安全：只允许 B 站自有 CDN 域名，杜绝 SSRF。
 * 性能：完整透传 HTTP Range，否则无法拖动进度条。
 */

import { NextRequest } from "next/server";
import { UA } from "@/lib/bilibase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = [
  /\.hdslb\.com$/,
  /\.biliivideo\.com$/,
  /\.bilivideo\.com$/,
  /\.bilibili\.com$/,
  /\.akamaized\.net$/,
  /\.biliapi\.net$/,
  /\.biliapi\.com$/,
  /\.bilivideo\.cn$/,
];

function decodeTarget(raw: string): URL | null {
  let candidate = raw;
  try {
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = Buffer.from(candidate, "base64").toString("utf8");
    }
  } catch {
    /* 不是 base64 */
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!ALLOWED_HOSTS.some((re) => re.test(u.hostname))) return null;
    return u;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return new Response("missing param u", { status: 400 });

  const target = decodeTarget(raw);
  if (!target) return new Response("invalid or disallowed url", { status: 400 });

  // 透传其余查询参数（B 站的鉴权参数都挂在 query 上）
  request.nextUrl.searchParams.forEach((v, k) => {
    if (k !== "u") target.searchParams.set(k, v);
  });

  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
    Accept: "*/*",
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  const ifRange = request.headers.get("if-range");
  if (ifRange) headers["If-Range"] = ifRange;

  let upstream: Response;
  try {
    // 若配置了 API 中转（BILI_API_PROXY_BASE），视频流也一并走中转，
    // 否则 Cloudflare / Serverless 的出口 IP 可能被 B 站 CDN 拒绝。
    const relay = process.env.BILI_API_PROXY_BASE?.replace(/\/$/, "");
    const relayToken = process.env.BILI_API_PROXY_TOKEN;
    const fetchUrl = relay
      ? `${relay}?url=${encodeURIComponent(target.toString())}`
      : target.toString();
    const relayHeaders: Record<string, string> = relayToken
      ? { "x-relay-token": relayToken }
      : {};
    upstream = await fetch(fetchUrl, {
      headers: { ...headers, ...relayHeaders },
      redirect: "follow",
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    const hint =
      upstream.status === 403
        ? "上游 CDN 拒绝（403）：多为来源 IP 被 B 站拉黑。Vercel / Cloudflare 出口段常被封，需配 BILI_API_PROXY_BASE 走干净 IP，或把视频流交给 Cloudflare Worker。"
        : upstream.status === 404
          ? "上游 404：播放地址已过期（B 站地址有时效），刷新页面重试"
          : `上游返回 ${upstream.status}`;
    return new Response(`upstream ${upstream.status} — ${hint}`, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const respHeaders = new Headers();
  for (const h of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }
  respHeaders.set("Access-Control-Allow-Origin", "*");
  respHeaders.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges",
  );
  respHeaders.set("Cache-Control", "public, max-age=3600");

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}
