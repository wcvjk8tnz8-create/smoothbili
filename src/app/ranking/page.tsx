import Link from "next/link";
import { getRanking } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import { img, formatCount, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "排行榜" };

const RIDS = [
  { v: 0, label: "全站" },
  { v: 1, label: "动画" },
  { v: 4, label: "游戏" },
  { v: 36, label: "科技" },
  { v: 188, label: "数码" },
  { v: 234, label: "运动" },
  { v: 223, label: "汽车" },
  { v: 160, label: "生活" },
  { v: 211, label: "美食" },
  { v: 217, label: "动物圈" },
  { v: 119, label: "鬼畜" },
  { v: 155, label: "时尚" },
  { v: 3, label: "音乐" },
  { v: 5, label: "娱乐" },
];

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ rid?: string }>;
}) {
  const sp = await searchParams;
  const rid = Number(sp.rid) || 0;
  const cred = await getCredential();

  let list: Array<{
    bvid: string;
    title: string;
    pic: string;
    duration: number;
    owner: { mid: number; name: string; face: string };
    stat: { view: number; danmaku: number; like: number };
    score: number;
  }> = [];
  let note = "";
  let error: string | null = null;

  try {
    const data = (await getRanking(rid, "all", cred)) as {
      list?: typeof list;
      note?: string;
    };
    list = data.list ?? [];
    note = data.note ?? "";
  } catch (e) {
    error = e instanceof Error ? e.message : "加载失败";
  }

  return (
    <div className="container">
      <div className="section-head">
        <h1 className="section-title">排行榜</h1>
        {note ? <span className="section-sub">{note}</span> : null}
      </div>

      <div className="chips">
        {RIDS.map((r) => (
          <Link
            key={r.v}
            href={`/ranking?rid=${r.v}`}
            className={`chip${r.v === rid ? " active" : ""}`}
            prefetch={false}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {error ? (
        <div className="banner banner-warn" style={{ marginTop: 18 }}>
          {error}
        </div>
      ) : list.length === 0 ? (
        <div className="empty">暂无排行数据</div>
      ) : (
        <div style={{ marginTop: 18 }}>
          {list.map((v, i) => (
            <Link
              key={v.bvid}
              href={`/video/${v.bvid}`}
              className="card"
              prefetch={false}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "center",
                padding: 12,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 26,
                  textAlign: "center",
                  fontWeight: 800,
                  fontSize: 16,
                  color: i < 3 ? "var(--brand)" : "var(--text-faint)",
                }}
              >
                {i + 1}
              </span>
              <div
                style={{
                  width: 150,
                  aspectRatio: "16 / 9",
                  borderRadius: 8,
                  overflow: "hidden",
                  flex: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img(v.pic, "@300w_170h_1c.webp")}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card-title">{v.title}</div>
                <div className="card-meta" style={{ marginTop: 6 }}>
                  <span className="up">{v.owner?.name}</span>
                </div>
                <div className="card-meta" style={{ marginTop: 4 }}>
                  <span>{formatCount(v.stat?.view)} 播放</span>
                  <span>·</span>
                  <span>{formatCount(v.stat?.danmaku)} 弹幕</span>
                  <span>·</span>
                  <span>{formatCount(v.stat?.like)} 点赞</span>
                  <span>·</span>
                  <span>{formatDuration(v.duration)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--brand)" }}>
                  综合得分 {v.score}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
