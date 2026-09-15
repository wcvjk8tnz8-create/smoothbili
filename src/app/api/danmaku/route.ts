/** 弹幕：服务端拉取 XML 并解析成 JSON */

import { NextResponse } from "next/server";
import { getDanmaku } from "@/lib/bili";
import { getCredential } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cid = Number(new URL(request.url).searchParams.get("cid"));
  if (!Number.isFinite(cid) || cid <= 0) {
    return NextResponse.json(
      { code: -400, message: "缺少 cid" },
      { status: 400 },
    );
  }
  const cred = await getCredential();
  try {
    const list = await getDanmaku(cid, cred);
    return NextResponse.json(
      { code: 0, data: list },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "弹幕加载失败", data: [] },
      { status: 200 },
    );
  }
}
