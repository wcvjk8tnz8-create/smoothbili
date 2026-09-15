/** 搜索建议 */

import { NextResponse } from "next/server";
import { searchSuggest } from "@/lib/bili";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("term") ?? "";
  if (!term.trim()) {
    return NextResponse.json(
      { code: 0, data: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const data = await searchSuggest(term);
    return NextResponse.json(
      { code: 0, data },
      { headers: { "Cache-Control": "public, max-age=600" } },
    );
  } catch {
    return NextResponse.json(
      { code: -1, data: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
