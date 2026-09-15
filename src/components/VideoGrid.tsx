import VideoCard from "./VideoCard";
import type { VideoItem } from "@/lib/types";

export default function VideoGrid({
  items,
  reasons,
}: {
  items: VideoItem[];
  reasons?: Record<string, string>;
}) {
  if (!items?.length) return null;
  return (
    <div className="grid">
      {items.map((it, i) => (
        <div key={`${it.bvid}-${i}`}>
          <VideoCard item={it} />
          {reasons?.[it.bvid] ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "var(--text-faint)",
                paddingLeft: 2,
              }}
            >
              {reasons[it.bvid]}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
