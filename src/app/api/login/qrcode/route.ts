/** 生成登录二维码：只回传 key 与内容，二维码由前端本地渲染 */

import { NextResponse } from "next/server";
import { generateLoginQrcode } from "@/lib/bili";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { url, qrcode_key } = await generateLoginQrcode();
    return NextResponse.json(
      { code: 0, data: { qrcode_key, url } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "生成二维码失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
