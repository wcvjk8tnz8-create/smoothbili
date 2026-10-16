/** 轮询扫码结果，成功后把凭据加密写进 httpOnly Cookie */

import { NextResponse } from "next/server";
import { pollLoginQrcode, getMyInfo } from "@/lib/bili";
import { getGuestIdentity, restoreGuestIdentity } from "@/lib/bilibase";
import {
  encodeCredential,
  sessionCookie,
  decodeGuestId,
  GUEST_COOKIE,
  type BiliCredential,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 从请求头里取出设备指纹 Cookie */
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
  const key = new URL(request.url).searchParams.get("qrcode_key");
  if (!key) {
    return NextResponse.json(
      { code: -400, message: "缺少 qrcode_key" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 先用 Cookie 里的指纹对齐（多实例下内存不共享，必须恢复）
  const fromCookie = readGuestCookie(request);
  if (fromCookie) restoreGuestIdentity(fromCookie);

  try {
    const guest = await getGuestIdentity();
    const result = await pollLoginQrcode(key, guest.buvid3);

    if (result.status !== "success") {
      // 失败时也把指纹写回去，保证后续重试仍是同一个 buvid3
      return NextResponse.json(
        { code: 0, status: result.status, message: result.message },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const cred: BiliCredential = {
      ...result.credential,
      refresh_token: result.refreshToken,
      exp: Date.now() + result.expires * 1000,
    };

    try {
      const me = await getMyInfo(cred);
      cred.uname = me.name;
      cred.face = me.face;
      cred.isLogin = true;
    } catch {
      /* 拿不到昵称不影响登录 */
    }

    const token = await encodeCredential(cred);
    return NextResponse.json(
      {
        code: 0,
        status: "success",
        user: { mid: cred.DedeUserID, uname: cred.uname, face: cred.face },
      },
      {
        headers: {
          "Set-Cookie": sessionCookie(token, result.expires),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "轮询失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
