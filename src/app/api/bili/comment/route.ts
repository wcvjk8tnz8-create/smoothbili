/** 评论翻页（前端懒加载用） */

import { NextResponse } from "next/server";
import { getComments } from "@/lib/bili";
import { getCredential } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const oid = Number(url.searchParams.get("oid"));
  const pn = Math.max(1, Number(url.searchParams.get("pn") ?? "1"));

  if (!Number.isFinite(oid) || oid <= 0) {
    return NextResponse.json(
      { code: -400, message: "缺少 oid" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cred = await getCredential();
  try {
    const data = await getComments(oid, { page: pn, ps: 20 }, cred);
    return NextResponse.json(
      { code: 0, data },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "评论加载失败" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
