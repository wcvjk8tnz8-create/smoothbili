/** 子评论（楼中楼） */

import { NextResponse } from "next/server";
import { biliFetch } from "@/lib/bilibase";
import { getCredential } from "@/lib/server";
import type { CommentItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const oid = Number(url.searchParams.get("oid"));
  const root = Number(url.searchParams.get("root"));

  if (!Number.isFinite(oid) || !Number.isFinite(root)) {
    return NextResponse.json(
      { code: -400, message: "缺少 oid 或 root" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cred = await getCredential();
  try {
    const data = await biliFetch<{ replies?: CommentItem[] }>(
      "https://api.bilibili.com/x/v2/reply/reply",
      { type: 1, oid, root, pn: 1, ps: 20, web_location: 1315875 },
      { cred, cacheTtl: 300 },
    );
    return NextResponse.json(
      { code: 0, data: data.replies ?? [] },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "加载失败", data: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
