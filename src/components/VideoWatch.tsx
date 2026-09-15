"use client";

/** 视频页交互壳：分 P 切换 + 三连 + 评论加载 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { img, formatCount, formatRelativeTime } from "@/lib/format";
import type { CommentItem, VideoPage } from "@/lib/types";

const Player = dynamic(() => import("./Player"), {
  ssr: false,
  loading: () => (
    <div
      className="player-wrap"
      style={{ display: "grid", placeItems: "center", color: "#fff" }}
    >
      播放器加载中…
    </div>
  ),
});

export default function VideoWatch({
  video,
  initialComments,
  initialCommentCount,
  initialCid,
}: {
  video: VideoPage;
  initialComments: CommentItem[];
  initialCommentCount: number;
  initialCid: number;
}) {
  const router = useRouter();
  const [cid, setCid] = useState(initialCid);
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [page, setPage] = useState(1);
  const [loadingComments, setLoadingComments] = useState(false);
  const [hasMore, setHasMore] = useState(initialComments.length >= 20);
  const [toast, setToast] = useState<string | null>(null);

  const currentPart = video.pages.find((p) => p.cid === cid) ?? video.pages[0];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const loadMore = useCallback(async () => {
    if (loadingComments || !hasMore) return;
    setLoadingComments(true);
    try {
      const next = page + 1;
      const res = await fetch(
        `/api/bili/comment?oid=${video.aid}&pn=${next}`,
        { credentials: "same-origin" },
      );
      const json = await res.json();
      const list: CommentItem[] = json?.data?.replies ?? [];
      setComments((prev) => [...prev, ...list]);
      if (json?.data?.count) setCommentCount(json.data.count);
      setPage(next);
      if (list.length < 20) setHasMore(false);
    } catch {
      /* ignore */
    } finally {
      setLoadingComments(false);
    }
  }, [page, hasMore, loadingComments, video.aid]);

  const act = async (action: "like" | "coin" | "fav" | "triple") => {
    try {
      const res = await fetch("/api/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, aid: video.aid }),
      });
      const json = await res.json();
      setToast(json.code === 0 ? "操作成功" : json.message ?? "操作失败");
    } catch {
      setToast("网络错误");
    }
  };

  const switchPart = (p: { cid: number; page: number }) => {
    setCid(p.cid);
    router.replace(`/video/${video.bvid}?p=${p.page}`, { scroll: false });
  };

  return (
    <div className="container watch">
      <div>
        <Player
          key={cid}
          bvid={video.bvid}
          cid={cid}
          aid={video.aid}
          title={video.title}
          cover={img(video.pic)}
        />

        <h1 className="video-title">{video.title}</h1>

        <div className="video-stats">
          <span>{formatCount(video.stat.view)} 播放</span>
          <span>{formatCount(video.stat.danmaku)} 弹幕</span>
          <span>{formatRelativeTime(video.pubdate)}</span>
          <span>{video.bvid}</span>
        </div>

        <div className="actions">
          <button className="btn" onClick={() => act("like")}>
            👍 点赞 {formatCount(video.stat.like)}
          </button>
          <button className="btn" onClick={() => act("coin")}>
            🪙 投币 {formatCount(video.stat.coin)}
          </button>
          <button className="btn" onClick={() => act("fav")}>
            ⭐ 收藏 {formatCount(video.stat.favorite)}
          </button>
          <button className="btn btn-primary" onClick={() => act("triple")}>
            三连
          </button>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(location.href).catch(() => {});
              setToast("已复制链接");
            }}
          >
            🔗 分享
          </button>
        </div>

        <Link href={`/space/${video.owner.mid}`} className="up-row" prefetch={false}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="up-avatar" src={img(video.owner.face, ".webp")} alt={video.owner.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{video.owner.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
              UID {video.owner.mid} · 点击进入主页
            </div>
          </div>
        </Link>

        {video.desc?.trim() ? <div className="desc">{video.desc}</div> : null}

        {/* 评论 */}
        <div className="comments">
          <div className="section-head">
            <h2 className="section-title">评论</h2>
            <span className="section-sub">{formatCount(commentCount)} 条</span>
          </div>

          {comments.length === 0 ? (
            <div className="empty">还没有评论</div>
          ) : (
            comments.map((c) => <CommentRow key={c.rpid} c={c} oid={video.aid} />)
          )}

          {hasMore && (
            <div className="pager">
              <button className="btn" onClick={loadMore} disabled={loadingComments}>
                {loadingComments ? "加载中…" : "加载更多评论"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 侧栏：分 P */}
      <aside>
        {video.pages.length > 1 && (
          <div className="side-block">
            <div className="side-head">分 P（{video.pages.length}）</div>
            <div className="plist">
              {video.pages.map((p) => (
                <div
                  key={p.cid}
                  className={`pitem${p.cid === cid ? " active" : ""}`}
                  onClick={() => switchPart(p)}
                >
                  <span className="pitem-idx">P{p.page}</span>
                  <span className="pitem-title">{p.part || `第 ${p.page} 集`}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="side-block" style={{ marginTop: 16 }}>
          <div className="side-head">当前播放</div>
          <div style={{ padding: "12px 14px", fontSize: 13.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {currentPart?.part || "正片"}
            </div>
            <div style={{ color: "var(--text-dim)" }}>cid {cid}</div>
          </div>
        </div>
      </aside>

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 60,
            transform: "translateX(-50%)",
            background: "rgba(20,20,26,.94)",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 14,
            zIndex: 300,
            boxShadow: "0 8px 30px rgba(0,0,0,.3)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function CommentRow({ c, oid }: { c: CommentItem; oid: number }) {
  const [replies, setReplies] = useState<CommentItem[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadReplies = async () => {
    if (replies) {
      setOpen((v) => !v);
      return;
    }
    try {
      const res = await fetch(
        `/api/bili/comment/reply?oid=${oid}&root=${c.rpid}`,
        { credentials: "same-origin" },
      );
      const json = await res.json();
      setReplies(json?.data ?? []);
      setOpen(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="cmt">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cmt-avatar" src={img(c.member.avatar, ".webp")} alt={c.member.uname} />
      <div className="cmt-body">
        <div className="cmt-user">
          {c.member.uname}
          <span className="cmt-level">Lv{c.member.level_info?.current_level ?? 0}</span>
        </div>
        <div className="cmt-text">{c.content.message}</div>
        <div className="cmt-foot">
          <span>👍 {c.like}</span>
          <span>{formatRelativeTime(c.ctime)}</span>
          {c.rcount ? (
            <span style={{ cursor: "pointer", color: "var(--brand)" }} onClick={loadReplies}>
              {open ? "收起" : `查看 ${c.rcount} 条回复`}
            </span>
          ) : null}
        </div>

        {open && replies && (
          <div className="cmt-replies">
            {replies.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-faint)" }}>暂无回复</div>
            ) : (
              replies.map((r) => (
                <div className="cmt" key={r.rpid}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="cmt-avatar"
                    src={img(r.member.avatar, ".webp")}
                    alt=""
                    style={{ width: 28, height: 28 }}
                  />
                  <div className="cmt-body">
                    <div className="cmt-user">{r.member.uname}</div>
                    <div className="cmt-text">{r.content.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
