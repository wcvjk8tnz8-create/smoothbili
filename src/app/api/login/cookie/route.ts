/**
 * 手动导入 Cookie（扫码登录的兜底方案）。
 * 用户从浏览器复制自己 B 站的 Cookie 粘进来，我们解析出关键字段并加密存储。
 */

import { NextResponse } from "next/server";
import {
  encodeCredential,
  parseCookieText,
  sessionCookie,
  type BiliCredential,
} from "@/lib/session";
import { getMyInfo } from "@/lib/bili";
import { getGuestIdentity } from "@/lib/bilibase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cookie?: string };
    const text = (body.cookie ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { code: -400, message: "请粘贴 Cookie" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const parsed = parseCookieText(text);
    if (!parsed.SESSDATA || !parsed.DedeUserID) {
      return NextResponse.json(
        {
          code: -400,
          message: "Cookie 中未找到 SESSDATA 或 DedeUserID，请确认复制完整",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const guest = await getGuestIdentity();
    const cred: BiliCredential = {
      DedeUserID: parsed.DedeUserID,
      DedeUserID__ckMd5: parsed.DedeUserID__ckMd5 ?? "",
      SESSDATA: parsed.SESSDATA,
      bili_jct: parsed.bili_jct ?? "",
      buvid3: parsed.buvid3 || guest.buvid3,
      isLogin: true,
      exp: Date.now() + 25 * 24 * 60 * 60 * 1000,
    };

    try {
      const me = await getMyInfo(cred);
      cred.uname = me.name;
      cred.face = me.face;
      if (!me.isLogin) {
        return NextResponse.json(
          { code: -101, message: "Cookie 已失效，请重新获取" },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    } catch {
      return NextResponse.json(
        { code: -101, message: "Cookie 无效或已失效" },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
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
          "Set-Cookie": sessionCookie(token, 25 * 24 * 60 * 60),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "导入失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
