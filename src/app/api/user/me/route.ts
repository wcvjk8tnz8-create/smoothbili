/** 当前登录态 */

import { NextResponse } from "next/server";
import { getCredential } from "@/lib/server";
import { getMyInfo } from "@/lib/bili";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cred = await getCredential();
  if (!cred) {
    return NextResponse.json(
      { code: 0, isLogin: false, user: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const me = await getMyInfo(cred);
    return NextResponse.json(
      {
        code: 0,
        isLogin: true,
        user: { mid: me.mid, uname: me.name, face: me.face, level: me.level },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { code: 0, isLogin: false, user: null, expired: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
