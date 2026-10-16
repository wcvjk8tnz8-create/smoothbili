/**
 * 登录诊断端点（临时排查用）
 *
 * 用法：在浏览器打开
 *   /api/login/debug              查看设备指纹与环境状态
 *   /api/login/debug?key=xxx      额外打一次 poll，看 B 站到底回了什么
 *
 * 所有敏感值都做脱敏（只显示长度与前 4 位）。
 * 排查完建议删掉本文件或加访问控制。
 */

import { NextResponse } from "next/server";
import { pollLoginQrcode } from "@/lib/bili";
import {
  getGuestIdentity,
  restoreGuestIdentity,
  currentGuestIdentity,
  usingProxy,
  resolveUrl,
} from "@/lib/bilibase";
import { decodeGuestId, GUEST_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 只显示长度与前 4 位，避免泄露完整凭据 */
function mask(v?: string | null) {
  if (!v) return null;
  return `${v.slice(0, 4)}…(len=${v.length})`;
}

function readGuestCookie(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  for (const seg of raw.split(";")) {
    const i = seg.indexOf("=");
    if (i <= 0) continue;
    if (seg.slice(0, i).trim() === GUEST_COOKIE) {
      return decodeGuestId(seg.slice(i + 1).trim());
    }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  const fromCookie = readGuestCookie(request);
  if (fromCookie) restoreGuestIdentity(fromCookie);
  const guest = await getGuestIdentity();

  const env = {
    nodeEnv: process.env.NODE_ENV ?? "(未设置)",
    hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    apiRelay: usingProxy ? "已配置 BILI_API_PROXY_BASE" : "直连 B 站(可能被封)",
    playbackProxy: process.env.PLAYBACK_PROXY_BASE ? "已配置" : "走本站 /api/playback",
    sampleUpstream: resolveUrl("https://api.bilibili.com/x/web-interface/nav").slice(0, 80),
  };

  const fingerprint = {
    cookieBuvid3: mask(fromCookie?.buvid3),
    memoryBuvid3: mask(guest.buvid3),
    aligned: Boolean(fromCookie && fromCookie.buvid3 === guest.buvid3),
  };

  const out: Record<string, unknown> = {
    hint: "aligned=true 表示设备指纹跨实例一致（正常）。若为 false，说明 Cookie 没带上，B 站会拒绝下发登录 Cookie。",
    env,
    fingerprint,
  };

  if (!key) {
    out.next = "带 ?key=二维码key 再请求一次，可看到 B 站 poll 的原始回包结构";
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  }

  // 直接打一次 poll，返回脱敏后的结构
  try {
    const probeUrl = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`;
    const res = await fetch(resolveUrl(probeUrl), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com/",
        Cookie: `buvid3=${guest.buvid3}; buvid4=${guest.buvid4}`,
      },
      signal: AbortSignal.timeout(12000),
    });

    const text = await res.text();

    let setCookieNames: string[] = [];
    try {
      const h = res.headers as unknown as { getSetCookie?: () => string[] };
      if (typeof h.getSetCookie === "function") {
        setCookieNames = h.getSetCookie().map((c) => c.split("=")[0]);
      }
    } catch {
      /* ignore */
    }
    if (!setCookieNames.length && res.headers.get("set-cookie")) {
      setCookieNames = ["(合并为单条)"];
    }

    let parsed: unknown = null;
    let bizCode: unknown = null;
    let urlKeys: string[] = [];
    let isJson = true;
    try {
      parsed = JSON.parse(text);
      const p = parsed as { code?: unknown; data?: { code?: unknown; url?: string } };
      bizCode = p.data?.code ?? p.code;
      const u = p.data?.url ?? "";
      urlKeys = u ? [...new Set(u.slice(u.indexOf("?") + 1).split("&").map((s) => s.split("=")[0]))] : [];
    } catch {
      isJson = false;
    }

    out.poll = {
      httpStatus: res.status,
      isJson,
      bodyPreview: isJson ? undefined : text.slice(0, 200),
      bizCode,
      callbackUrlFields: urlKeys,
      setCookieNames,
      verdict: !isJson
        ? "返回的不是 JSON —— 多半是被 B 站 WAF 拦截（IP 被封），需配 BILI_API_PROXY_BASE"
        : bizCode === 0
          ? setCookieNames.length || urlKeys.length
            ? "B 站有回数据，检查字段里是否含 SESSDATA / DedeUserID"
            : "code=0 但两条通道都空 —— 设备指纹不一致或二维码已失效"
          : `业务码 ${bizCode}（86038=已失效 86039=待扫码 86090=已扫码待确认）`,
    };

    // 同时跑一遍封装函数，看它最终判定成什么
    const r = await pollLoginQrcode(key, guest.buvid3);
    out.ourResult =
      r.status === "success"
        ? {
            status: r.status,
            credentialFields: Object.keys(r.credential),
            sessdata: mask(r.credential.SESSDATA),
          }
        : { status: r.status, message: r.message };
  } catch (e) {
    out.pollError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
