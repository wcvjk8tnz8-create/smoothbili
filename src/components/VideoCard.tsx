import Link from "next/link";
import { img, formatCount, formatDuration, formatRelativeTime } from "@/lib/format";
import type { VideoItem } from "@/lib/types";

export default function VideoCard({ item }: { item: VideoItem }) {
  return (
    <Link href={`/video/${item.bvid}`} className="card" prefetch={false}>
      <div className="card-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img(item.pic, "@672w_378h_1c.webp")} alt={item.title} loading="lazy" />
        <span className="card-badge">{formatDuration(item.duration)}</span>
      </div>
      <div className="card-info">
        <div className="card-title">{item.title}</div>
        <div className="card-meta">
          <span className="up">{item.owner?.name}</span>
        </div>
        <div className="card-meta">
          <span>{formatCount(item.stat?.view)} 播放</span>
          <span>·</span>
          <span>
            {item.pubdate ? formatRelativeTime(item.pubdate) : formatCount(item.stat?.danmaku)}
          </span>
        </div>
      </div>
    </Link>
  );
}
