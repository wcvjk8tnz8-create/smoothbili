/** 封面 / 头像代理：B 站图床校验 Referer，统一走这里并加缓存 */

import { NextRequest } from "next/server";
import { UA } from "@/lib/bilibase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = [
  /\.hdslb\.com$/,
  /\.biliimg\.com$/,
  /\.bilibili\.com$/,
  /\.bilivideo\.com$/,
];

const PLACEHOLDER = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u") ?? "";
  if (!raw) return new Response("missing u", { status: 400 });

  let candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  if (!/^https?:\/\//i.test(candidate)) {
    try {
      candidate = Buffer.from(candidate, "base64").toString("utf8");
    } catch {
      /* ignore */
    }
  }

  let target: URL;
  try {
    target = new URL(candidate);
    if (!ALLOWED.some((re) => re.test(target.hostname))) {
      return new Response("disallowed host", { status: 400 });
    }
  } catch {
    return new Response("bad url", { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      Accept: request.headers.get("accept") ?? "image/*",
    },
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    return new Response(PLACEHOLDER, {
      headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=3600" },
    });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=86400, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: 200, headers });
}
