/** 退出登录 */

import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { code: 0, message: "已退出" },
    { headers: { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" } },
  );
}
