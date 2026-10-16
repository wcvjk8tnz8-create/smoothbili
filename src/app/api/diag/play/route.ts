/**
 * 播放链路诊断（排查"视频播放不了"用）
 *
 * 用法：
 *   /api/diag/play                        只查环境配置
 *   /api/diag/play?bvid=BV1xx411c7mD      完整跑一遍：取地址 → 试转发前 1KB
 *
 * 会依次检查三个环节，任一环断掉都会在 verdict 里直接说明原因和解法。
 * 所有 URL 只显示域名与长度，不回显完整鉴权参数。
 */

import { NextResponse } from "next/server";
import { getPlayUrl } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import { UA } from "@/lib/bilibase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 只留域名和长度，避免泄露鉴权参数 */
function brief(u?: string) {
  if (!u) return null;
  try {
    const x = new URL(u.startsWith("//") ? `https:${u}` : u);
    return `${x.hostname}${x.pathname.slice(0, 24)}…(len=${u.length})`;
  } catch {
    return `(len=${u.length})`;
  }
}

/** 环境判定：是否在 Vercel / Cloudflare 等 Serverless 上 */
function detectPlatform() {
  const env = process.env;
  if (env.VERCEL) return `Vercel (region=${env.VERCEL_REGION ?? "?"}, env=${env.VERCEL_ENV ?? "?"})`;
  if (env.CF_PAGES || env.CF_ACCOUNT_ID) return "Cloudflare Pages";
  if (process.env.WORKERS_CI) return "Cloudflare Workers";
  return "未知 / 自建服务器（Node）";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bvid = url.searchParams.get("bvid");
  const cidParam = url.searchParams.get("cid");

  const onVercel = Boolean(process.env.VERCEL);
  const playbackProxy = process.env.PLAYBACK_PROXY_BASE?.replace(/\/$/, "") ?? "";
  const apiRelay = process.env.BILI_API_PROXY_BASE?.replace(/\/$/, "") ?? "";

  const out: Record<string, unknown> = {
    platform: detectPlatform(),
    config: {
      PLAYBACK_PROXY_BASE: playbackProxy || "❌ 未配置（视频流将走本站 /api/playback）",
      BILI_API_PROXY_BASE: apiRelay || "❌ 未配置（B 站接口直连，可能被封 IP）",
      SESSION_SECRET: process.env.SESSION_SECRET ? "已配置" : "❌ 使用不安全的默认值",
    },
  };

  // 环节 0：架构体检（不需要 bvid 也能给出结论）
  out.architecture = onVercel
    ? {
        verdict: playbackProxy
          ? "✅ 已配 PLAYBACK_PROXY_BASE，视频流走外部代理，架构正确"
          : "❌ 运行在 Vercel 但未配 PLAYBACK_PROXY_BASE —— 视频流会走 Vercel 函数转发，必然失败",
        reasons: playbackProxy
          ? []
          : [
              "Vercel 函数响应体上限 4.5MB（视频流远超此限制）",
              "Vercel Hobby 函数超时 60s（长连接会被切断）",
              "Vercel 带宽 100GB/月（看几个视频就耗尽）",
            ],
        fix: playbackProxy
          ? null
          : "部署 docs/cloudflare-worker.js，把地址填进 Vercel 的 PLAYBACK_PROXY_BASE 环境变量后 Redeploy",
      }
    : { verdict: "非 Vercel 环境，视频流走本站 /api/playback 即可", reasons: [] };

  if (!bvid) {
    out.next = "带 ?bvid=BV号 再请求一次，可完整跑通「取地址 → 试转发」两个环节";
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  }

  // 环节 1：能否拿到播放地址（检验 B 站 API 是否通、是否被风控）
  let cid = Number(cidParam);
  if (!Number.isFinite(cid) || cid <= 0) {
    try {
      const viewRes = await fetch(
        `${apiRelay ? `${apiRelay}?url=${encodeURIComponent(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)}` : `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`}`,
        {
          headers: {
            "User-Agent": UA,
            Referer: "https://www.bilibili.com/",
            ...(process.env.BILI_API_PROXY_TOKEN
              ? { "x-relay-token": process.env.BILI_API_PROXY_TOKEN }
              : {}),
          },
          signal: AbortSignal.timeout(12000),
        },
      );
      const vj = (await viewRes.json()) as { code?: number; data?: { cid?: number; title?: string } };
      cid = vj.data?.cid ?? 0;
      out.video = { title: vj.data?.title ?? "(未取到)", cid, viewCode: vj.code };
      if (!cid) {
        out.step1 = {
          ok: false,
          verdict: `❌ 取不到 cid（code=${vj.code}）`,
          hint: vj.code === -352 || vj.code === -403
            ? "B 站风控 —— 需登录，或配 BILI_API_PROXY_BASE 走干净 IP"
            : "接口不通或视频不存在",
        };
        return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
      }
    } catch (e) {
      out.step1 = {
        ok: false,
        verdict: "❌ 请求视频信息失败",
        error: e instanceof Error ? e.message : String(e),
      };
      return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
    }
  }

  // 取播放地址
  let firstUrl = "";
  try {
    const cred = await getCredential();
    const data = await getPlayUrl({ bvid, cid, qn: 127, fnval: 4048 }, cred);
    const v = data.dash?.video?.[0];
    const a = data.dash?.audio?.[0];
    firstUrl = (v?.base_url ?? v?.baseUrl ?? a?.base_url ?? a?.baseUrl ?? "") as string;
    out.step1 = {
      ok: Boolean(firstUrl),
      isLogin: Boolean(cred?.SESSDATA),
      quality: (data as { quality?: number }).quality ?? null,
      videoTracks: data.dash?.video?.length ?? 0,
      audioTracks: data.dash?.audio?.length ?? 0,
      firstUrl: brief(firstUrl),
      verdict: firstUrl
        ? "✅ 已拿到播放地址"
        : "❌ B 站未返回播放地址（多为风控 / 大会员限制 / 地区限制）",
    };
    if (!firstUrl) return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    out.step1 = {
      ok: false,
      verdict: "❌ 获取播放地址失败",
      error: e instanceof Error ? e.message : String(e),
      hint: "含 -352 / -403 即为风控：需登录或配 BILI_API_PROXY_BASE",
    };
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  }

  // 环节 2：实际转发测试（只取前 1KB，避免浪费带宽）
  const fixed = firstUrl.startsWith("//") ? `https:${firstUrl}` : firstUrl;
  const candidates: { name: string; url: string }[] = [];
  if (playbackProxy) {
    candidates.push({
      name: "外部流代理 (PLAYBACK_PROXY_BASE)",
      url: `${playbackProxy}?u=${encodeURIComponent(fixed)}`,
    });
  }
  candidates.push({
    name: "本站 /api/playback",
    url: `${new URL(request.url).origin}/api/playback?u=${Buffer.from(fixed).toString("base64")}`,
  });

  const probes: Record<string, unknown>[] = [];
  for (const c of candidates) {
    try {
      const t0 = Date.now();
      const res = await fetch(c.url, {
        headers: {
          Range: "bytes=0-1023",
          "User-Agent": UA,
          Referer: "https://www.bilibili.com/",
        },
        signal: AbortSignal.timeout(20000),
      });
      const buf = await res.arrayBuffer();
      const ms = Date.now() - t0;
      probes.push({
        via: c.name,
        httpStatus: res.status,
        bytes: buf.byteLength,
        ms,
        contentRange: res.headers.get("content-range") ?? "(无)",
        acceptRanges: res.headers.get("accept-ranges") ?? "(无)",
        ok: res.status === 200 || res.status === 206,
        note:
          res.status === 403
            ? "403 —— 上游 CDN 拒绝了 Referer/来源 IP"
            : res.status >= 500
              ? `${res.status} —— 上游或代理自身错误`
              : buf.byteLength === 0
                ? "返回 0 字节"
                : res.status === 206 || res.headers.get("content-range")
                  ? "Range 正常，可拖动进度条"
                  : "未返回 206 —— 可能是代理不支持 Range，将无法拖动进度条",
      });
    } catch (e) {
      probes.push({
        via: c.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  out.step2 = { probes };

  const good = probes.find((p) => p.ok);
  out.finalVerdict = good
    ? `✅ 可用路径：${good.via}`
    : onVercel && !playbackProxy
      ? "❌ Vercel 上用本站 /api/playback 转发视频流必然失败（4.5MB 响应体上限 / 60s 超时）。请部署 docs/cloudflare-worker.js 并配置 PLAYBACK_PROXY_BASE。"
      : "❌ 所有路径均失败，检查上方 step2 的 note 字段";

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
