import Link from "next/link";
import VideoGrid from "@/components/VideoGrid";
import { getRecommend, getPopular, hotSearch } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import type { VideoItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const usePopular = tab === "popular";
  const cred = await getCredential();

  let items: VideoItem[] = [];
  let reasons: Record<string, string> = {};
  let error: string | null = null;

  try {
    if (usePopular) {
      items = await getPopular(cred, 1, 30);
    } else {
      items = await getRecommend(cred, 0, 30);
      reasons = Object.fromEntries(
        items
          .filter((v) => v.rcmd_reason?.content)
          .map((v) => [v.bvid, v.rcmd_reason!.content as string]),
      );
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "加载失败";
  }

  let hot: Array<{ keyword: string; show_name: string }> = [];
  try {
    hot = (await hotSearch()).slice(0, 12);
  } catch {
    /* 热搜失败不影响主流程 */
  }

  return (
    <div className="container">
      <div className="section-head">
        <h1 className="section-title">{usePopular ? "热门视频" : "推荐"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/"
            className={`chip${usePopular ? "" : " active"}`}
            prefetch={false}
          >
            推荐
          </Link>
          <Link
            href="/?tab=popular"
            className={`chip${usePopular ? " active" : ""}`}
            prefetch={false}
          >
            热门
          </Link>
        </div>
      </div>

      {hot.length > 0 && (
        <div className="chips" style={{ marginBottom: 18 }}>
          {hot.map((h) => (
            <Link
              key={h.keyword}
              href={`/search?keyword=${encodeURIComponent(h.keyword)}`}
              className="chip"
              prefetch={false}
            >
              🔥 {h.show_name || h.keyword}
            </Link>
          ))}
        </div>
      )}

      {error ? (
        <div className="banner banner-warn">
          加载失败：{error}
          <br />
          可能是 B 站风控（错误码 -352）或网络问题，稍后重试即可。登录后通常更稳定。
        </div>
      ) : items.length ? (
        <VideoGrid items={items} reasons={reasons} />
      ) : (
        <div className="empty">暂时没有内容</div>
      )}
    </div>
  );
}
