/** 点赞 / 投币 / 收藏 / 三连 / 播放进度上报 */

import { NextResponse } from "next/server";
import { interact, reportHeartbeat } from "@/lib/bili";
import { getCredential } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cred = await getCredential();
  if (!cred?.SESSDATA) {
    return NextResponse.json(
      { code: -101, message: "请先登录 B 站账号" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = (await request.json()) as {
      action?: string;
      aid?: number;
      cid?: number;
      like?: 0 | 1;
      multiply?: 1 | 2;
      playedTime?: number;
    };

    if (body.action === "heartbeat") {
      await reportHeartbeat(
        { aid: body.aid ?? 0, cid: body.cid ?? 0, playedTime: body.playedTime },
        cred,
      );
      return NextResponse.json(
        { code: 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const action = body.action as "like" | "coin" | "fav" | "triple";
    if (!["like", "coin", "fav", "triple"].includes(action)) {
      return NextResponse.json(
        { code: -400, message: "未知操作" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!body.aid) {
      return NextResponse.json(
        { code: -400, message: "缺少 aid" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const res = await interact(
      action,
      { aid: body.aid, like: body.like, multiply: body.multiply },
      cred,
    );
    return NextResponse.json(res, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { code: -1, message: e instanceof Error ? e.message : "操作失败" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
