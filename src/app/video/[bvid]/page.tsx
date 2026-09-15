import VideoWatch from "@/components/VideoWatch";
import { getVideoInfo, getComments } from "@/lib/bili";
import { getCredential } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bvid: string }>;
}) {
  const { bvid } = await params;
  const cred = await getCredential();
  try {
    const video = await getVideoInfo(bvid, cred);
    return {
      title: video.title,
      description: video.desc?.slice(0, 160),
      openGraph: { title: video.title, description: video.desc?.slice(0, 160) },
    };
  } catch {
    return { title: "视频" };
  }
}

export default async function VideoPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ bvid: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { bvid } = await params;
  const { p } = await searchParams;
  const cred = await getCredential();

  let video;
  try {
    video = await getVideoInfo(bvid, cred);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "无法加载视频";
    return (
      <div className="container">
        <div className="banner banner-warn" style={{ marginTop: 24 }}>
          {msg}
          <br />
          如果是风控提示（如 -352），登录 B 站账号后重试通常可解决。
        </div>
      </div>
    );
  }

  const partIndex = Math.max(1, Math.min(Number(p) || 1, video.pages.length || 1));
  const cid = video.pages[partIndex - 1]?.cid ?? video.cid;

  let comments: Awaited<ReturnType<typeof getComments>>["replies"] = [];
  let count = 0;
  try {
    const c = await getComments(video.aid, { page: 1, ps: 20 }, cred);
    comments = c.replies;
    count = c.count;
  } catch {
    /* 评论失败不阻塞播放 */
  }

  return (
    <VideoWatch
      video={video}
      initialComments={comments}
      initialCommentCount={count}
      initialCid={cid}
    />
  );
}
