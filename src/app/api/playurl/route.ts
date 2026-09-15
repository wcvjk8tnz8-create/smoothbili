/**
 * 播放地址接口：返回 DASH / MP4 信息，并把所有 URL 改写为本站代理地址。
 * 浏览器不直连 B 站 CDN，避免 Referer 403。
 */

import { NextResponse } from "next/server";
import { getPlayUrl } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import type { PlayUrlData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 把 B 站的直链换成代理地址。
 *
 * 默认走本站 /api/playback。若设置了 PLAYBACK_PROXY_BASE（例如自建的
 * Cloudflare Worker 流代理），则改用该地址 —— Vercel 等 Serverless 平台
 * 有函数超时与带宽限制，把视频流挪到 Workers 上更稳、也更省额度。
 */
function proxyUrl(u?: string): string {
  if (!u) return "";
  const fixed = u.startsWith("//") ? `https:${u}` : u;
  const base = process.env.PLAYBACK_PROXY_BASE?.replace(/\/$/, "");
  const query = `u=${Buffer.from(fixed).toString("base64")}`;
  return base ? `${base}?${query}` : `/api/playback?${query}`;
}

function rewrite(data: PlayUrlData): PlayUrlData {
  const out: PlayUrlData = { ...data };
  if (out.dash) {
    out.dash = {
      ...out.dash,
      video: (out.dash.video ?? []).map((s) => ({
        ...s,
        base_url: proxyUrl(s.base_url ?? s.baseUrl),
        baseUrl: proxyUrl(s.base_url ?? s.baseUrl),
        backup_url: undefined,
      })),
      audio: (out.dash.audio ?? []).map((s) => ({
        ...s,
        base_url: proxyUrl(s.base_url ?? s.baseUrl),
        baseUrl: proxyUrl(s.base_url ?? s.baseUrl),
        backup_url: undefined,
      })),
    };
    if (out.dash.dolby?.audio) {
      out.dash.dolby = {
        ...out.dash.dolby,
        audio: out.dash.dolby.audio.map((s) => ({
          ...s,
          base_url: proxyUrl(s.base_url ?? s.baseUrl),
          baseUrl: proxyUrl(s.base_url ?? s.baseUrl),
        })),
      };
    }
  }
  if (out.durl) {
    out.durl = out.durl.map((d) => ({ ...d, url: proxyUrl(d.url) }));
  }
  return out;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bvid = url.searchParams.get("bvid");
  const cid = Number(url.searchParams.get("cid"));
  const qn = Number(url.searchParams.get("qn") ?? "127");

  if (!bvid || !Number.isFinite(cid) || cid <= 0) {
    return NextResponse.json(
      { code: -400, message: "缺少 bvid 或 cid" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cred = await getCredential();
  // mp4=1：降级方案，请求 MP4 直链（fnval=1），供 dash.js 不可用时原生播放
  const mp4 = url.searchParams.get("mp4") === "1";
  try {
    const data = await getPlayUrl({ bvid, cid, qn, fnval: mp4 ? 1 : 4048 }, cred);
    return NextResponse.json(
      { code: 0, data: rewrite(data), isLogin: Boolean(cred?.SESSDATA) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "获取播放地址失败";
    return NextResponse.json(
      { code: -1, message },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
