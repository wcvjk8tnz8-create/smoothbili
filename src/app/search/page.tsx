import Link from "next/link";
import VideoGrid from "@/components/VideoGrid";
import { search } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import { img, formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "video", label: "视频" },
  { key: "bili_user", label: "UP 主" },
  { key: "media_bangumi", label: "番剧" },
  { key: "media_ft", label: "影视" },
] as const;

const ORDERS = [
  { key: "totalrank", label: "综合" },
  { key: "click", label: "播放量" },
  { key: "pubdate", label: "最新发布" },
  { key: "dm", label: "弹幕数" },
  { key: "stow", label: "收藏数" },
] as const;

interface SearchVideoItem {
  bvid: string;
  title: string;
  pic: string;
  author: string;
  mid: number;
  duration: string;
  play: number;
  video_review: number;
  favorites: number;
  pubdate: number;
}

interface SearchUserItem {
  mid: number;
  uname: string;
  upic: string;
  fans: number;
  videos: number;
  usign: string;
}

function stripTags(s: string): string {
  return s?.replace(/<[^>]+>/g, "") ?? "";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    keyword?: string;
    type?: string;
    order?: string;
    page?: string;
    duration?: string;
  }>;
}) {
  const sp = await searchParams;
  const keyword = (sp.keyword ?? "").trim();
  const type =
    (TABS.find((t) => t.key === sp.type)?.key ?? "video") as (typeof TABS)[number]["key"];
  const order =
    (ORDERS.find((o) => o.key === sp.order)?.key ?? "totalrank") as (typeof ORDERS)[number]["key"];
  const page = Math.max(1, Number(sp.page) || 1);
  const duration = Number(sp.duration) || undefined;

  if (!keyword) {
    return (
      <div className="container">
        <div className="empty">
          输入关键词开始搜索
          <div style={{ marginTop: 12, fontSize: 13 }}>
            试试在顶部搜索框输入你感兴趣的 UP 主或视频名
          </div>
        </div>
      </div>
    );
  }

  const cred = await getCredential();
  let result: unknown[] = [];
  let numPages = 0;
  let numResults = 0;
  let error: string | null = null;

  try {
    const data = await search({ keyword, searchType: type, order, page, duration }, cred);
    result = data.result ?? [];
    numPages = data.numPages ?? 0;
    numResults = data.numResults ?? 0;
  } catch (e) {
    error = e instanceof Error ? e.message : "搜索失败";
  }

  const buildHref = (patch: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams({ keyword, type, order });
    if (duration) qs.set("duration", String(duration));
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) qs.delete(k);
      else qs.set(k, String(v));
    }
    return `/search?${qs.toString()}`;
  };

  return (
    <div className="container">
      <div className="section-head">
        <h1 className="section-title">“{keyword}” 的搜索结果</h1>
        <span className="section-sub">约 {formatCount(numResults)} 条</span>
      </div>

      <div className="chips">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={buildHref({ type: t.key, page: 1 })}
            className={`chip${t.key === type ? " active" : ""}`}
            prefetch={false}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {type === "video" && (
        <div className="chips" style={{ marginTop: 12 }}>
          {ORDERS.map((o) => (
            <Link
              key={o.key}
              href={buildHref({ order: o.key, page: 1 })}
              className={`chip${o.key === order ? " active" : ""}`}
              prefetch={false}
            >
              {o.label}
            </Link>
          ))}
          <span style={{ width: 12 }} />
          {[
            { v: undefined, l: "时长不限" },
            { v: 1, l: "10 分钟内" },
            { v: 2, l: "10-30 分钟" },
            { v: 3, l: "30-60 分钟" },
            { v: 4, l: "60 分钟以上" },
          ].map((d) => (
            <Link
              key={d.l}
              href={buildHref({ duration: d.v, page: 1 })}
              className={`chip${(duration ?? undefined) === d.v ? " active" : ""}`}
              prefetch={false}
            >
              {d.l}
            </Link>
          ))}
        </div>
      )}

      {error ? (
        <div className="banner banner-warn" style={{ marginTop: 18 }}>
          {error}
        </div>
      ) : result.length === 0 ? (
        <div className="empty">没有找到相关内容</div>
      ) : (
        <div style={{ marginTop: 18 }}>
          {type === "video" && <SearchVideoList items={result as SearchVideoItem[]} />}
          {type === "bili_user" && <SearchUserList items={result as SearchUserItem[]} />}
        </div>
      )}

      <div className="pager">
        {page > 1 && (
          <Link href={buildHref({ page: page - 1 })} className="btn" prefetch={false}>
            上一页
          </Link>
        )}
        <span
          style={{ alignSelf: "center", color: "var(--text-dim)", fontSize: 13 }}
        >
          {page} / {Math.max(1, numPages)}
        </span>
        {page < numPages && (
          <Link href={buildHref({ page: page + 1 })} className="btn" prefetch={false}>
            下一页
          </Link>
        )}
      </div>
    </div>
  );
}

function parseDuration(s?: string): number {
  if (!s) return 0;
  const parts = s.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function SearchVideoList({ items }: { items: SearchVideoItem[] }) {
  const mapped = items.map((i) => ({
    bvid: i.bvid,
    title: stripTags(i.title),
    pic: i.pic,
    duration: parseDuration(i.duration),
    owner: { mid: i.mid, name: i.author, face: "" },
    stat: { view: i.play, danmaku: i.video_review, like: i.favorites },
    pubdate: i.pubdate,
  }));
  return <VideoGrid items={mapped} />;
}

function SearchUserList({ items }: { items: SearchUserItem[] }) {
  return (
    <div className="grid">
      {items.map((u) => (
        <Link key={u.mid} href={`/space/${u.mid}`} className="card" prefetch={false}>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 14,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img(u.upic, ".webp")}
              alt=""
              style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{stripTags(u.uname)}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
                {formatCount(u.fans)} 粉丝 · {u.videos} 视频
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-faint)",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {u.usign}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
