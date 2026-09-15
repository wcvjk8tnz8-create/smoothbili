/** 轮询扫码结果，成功后把凭据加密写进 httpOnly Cookie */

import { NextResponse } from "next/server";
import { pollLoginQrcode, getMyInfo } from "@/lib/bili";
import { getGuestIdentity } from "@/lib/bilibase";
import { encodeCredential, sessionCookie, type BiliCredential } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("qrcode_key");
  if (!key) {
    return NextResponse.json(
      { code: -400, message: "缺少 qrcode_key" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const guest = await getGuestIdentity();
    const result = await pollLoginQrcode(key, guest.buvid3);
    if (result.status !== "success") {
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
