import Link from "next/link";
import VideoGrid from "@/components/VideoGrid";
import { getSpaceArchives, getCard } from "@/lib/bili";
import { getCredential } from "@/lib/server";
import { img, formatCount } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mid: string }>;
}) {
  const { mid } = await params;
  const cred = await getCredential();
  try {
    const { card } = await getCard(Number(mid), cred);
    return { title: `${card.name} 的主页` };
  } catch {
    return { title: "UP 主主页" };
  }
}

export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ mid: string }>;
  searchParams: Promise<{ pn?: string; order?: string }>;
}) {
  const { mid: rawMid } = await params;
  const sp = await searchParams;
  const mid = Number(rawMid);

  if (!Number.isFinite(mid) || mid <= 0) {
    return (
      <div className="container">
        <div className="empty">无效的 UP 主 ID</div>
      </div>
    );
  }

  const pn = Math.max(1, Number(sp.pn) || 1);
  const order = sp.order === "click" ? "click" : "pubdate";
  const cred = await getCredential();

  let card: Awaited<ReturnType<typeof getCard>>["card"] | null = null;
  let archiveCount = 0;
  let items: Awaited<ReturnType<typeof getSpaceArchives>>["list"]["vlist"] = [];

  try {
    const [cardRes, arcRes] = await Promise.all([
      getCard(mid, cred).catch(() => null),
      getSpaceArchives(mid, { pn, ps: 30, order }, cred).catch(() => null),
    ]);
    card = cardRes?.card ?? null;
    archiveCount = cardRes?.archive_count ?? arcRes?.page?.count ?? 0;
    items = arcRes?.list?.vlist ?? [];
  } catch {
    /* ignore */
  }

  const buildHref = (patch: Record<string, string | number>) => {
    const qs = new URLSearchParams(
      Object.entries(patch).map(([k, v]) => [k, String(v)]),
    );
    return `/space/${mid}?${qs.toString()}`;
  };

  return (
    <div className="container">
      <div className="space-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="space-avatar" src={img(card?.face)} alt="" />
        <div>
          <h1 className="space-name">{card?.name ?? `UP 主 ${mid}`}</h1>
          <div className="space-sign">{card?.sign || "这个人很懒，什么都没写"}</div>
          <div className="space-stat">
            <span>
              粉丝 <b>{formatCount(card?.fans)}</b>
            </span>
            <span>
              稿件 <b>{formatCount(archiveCount)}</b>
            </span>
            <span>UID {mid}</span>
          </div>
        </div>
      </div>

      <div className="chips">
        <Link
          href={buildHref({ order: "pubdate", pn: 1 })}
          className={`chip${order === "pubdate" ? " active" : ""}`}
          prefetch={false}
        >
          最新发布
        </Link>
        <Link
          href={buildHref({ order: "click", pn: 1 })}
          className={`chip${order === "click" ? " active" : ""}`}
          prefetch={false}
        >
          最多播放
        </Link>
      </div>

      <div className="section-head">
        <h2 className="section-title">投稿</h2>
      </div>

      {items.length === 0 ? (
        <div className="empty">没有找到投稿</div>
      ) : (
        <VideoGrid items={items} />
      )}

      <div className="pager">
        {pn > 1 && (
          <Link href={buildHref({ order, pn: pn - 1 })} className="btn" prefetch={false}>
            上一页
          </Link>
        )}
        <span style={{ alignSelf: "center", color: "var(--text-dim)", fontSize: 13 }}>
          第 {pn} 页
        </span>
        {items.length >= 30 && (
          <Link href={buildHref({ order, pn: pn + 1 })} className="btn" prefetch={false}>
            下一页
          </Link>
        )}
      </div>
    </div>
  );
}
