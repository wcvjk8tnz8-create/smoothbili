/** 生成登录二维码：只回传 key 与内容，二维码由前端本地渲染 */

import { NextResponse } from "next/server";
import { generateLoginQrcode } from "@/lib/bili";
import { getGuestIdentity } from "@/lib/bilibase";
import { guestCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { url, qrcode_key } = await generateLoginQrcode();

    // 关键：把本次使用的设备指纹写进 Cookie。
    // Serverless 多实例下内存不共享，若不持久化，后续 poll 请求
    // 会落到别的实例并生成新的 buvid3，B 站便以"设备不一致"拒绝下发 Cookie。
    const guest = await getGuestIdentity();

    return NextResponse.json(
      { code: 0, data: { qrcode_key, url } },
      {
        headers: {
          "Set-Cookie": guestCookie(guest),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "生成二维码失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
