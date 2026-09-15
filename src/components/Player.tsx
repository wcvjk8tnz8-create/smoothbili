"use client";

/**
 * 播放器：
 *  - 主方案：dash.js（CDN 动态加载）播放 DASH，支持 4K / 高码率
 *  - 降级：dash.js 不可用时回退到 MP4 直链（fnval=1），用原生 <video>
 *  - 弹幕：Canvas 自绘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DanmakuLayer from "./DanmakuLayer";
import { formatDuration } from "@/lib/format";
import type { DashStream, Danmaku, PlayUrlData } from "@/lib/types";

declare global {
  interface Window {
    dashjs?: {
      MediaPlayer: () => {
        create: () => DashPlayer;
      };
    };
  }
}

interface DashPlayer {
  initialize: (v: HTMLVideoElement, src: string, auto: boolean) => void;
  destroy: () => void;
  updateSettings: (s: unknown) => void;
  setQualityFor: (type: "video", idx: number) => void;
}

const DASH_CDNS = [
  "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js",
  "https://unpkg.com/dashjs@4.7.4/dist/dash.all.min.js",
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exist = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (exist) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("load failed"));
    document.head.appendChild(s);
  });
}

async function ensureDash(): Promise<boolean> {
  if (window.dashjs) return true;
  for (const url of DASH_CDNS) {
    try {
      await loadScript(url);
      if (window.dashjs) return true;
    } catch {
      /* 换下一个 CDN */
    }
  }
  return false;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 从 B 站的 dash 数据构造 MPD（B 站不直接返回 MPD） */
function buildMpd(
  data: PlayUrlData,
  videoId: number,
  audioId: number | null,
): string {
  const video = (data.dash?.video ?? []).find((s) => s.id === videoId) ?? data.dash?.video?.[0];
  if (!video) throw new Error("没有可用的视频流");
  const audio =
    (data.dash?.audio ?? []).find((s) => s.id === audioId) ?? data.dash?.audio?.[0];

  const dur = (data.dash?.duration || data.timelength / 1000 || 0).toFixed(3);

  const rep = (s: DashStream, type: "video" | "audio") => {
    const sb = (s.segment_base ?? s.SegmentBase) as
      | {
          initialization?: string;
          index_range?: string;
          Initialization?: string;
          indexRange?: string;
        }
      | undefined;
    const init = sb?.initialization ?? sb?.Initialization ?? "";
    const idxRange = sb?.index_range ?? sb?.indexRange ?? "";
    const url = s.base_url ?? s.baseUrl ?? "";
    const codec = s.codecs || (type === "video" ? "avc1.640032" : "mp4a.40.2");
    const mime = s.mime_type ?? s.mimeType ?? (type === "video" ? "video/mp4" : "audio/mp4");
    const attrs =
      type === "video"
        ? `width="${s.width || 1920}" height="${s.height || 1080}" sar="1:1" frameRate="${s.frame_rate ?? "30"}"`
        : `audioSamplingRate="44100"`;
    return `<Representation id="${s.id}" bandwidth="${s.bandwidth || 1000000}" codecs="${codec}" mimeType="${mime}" ${attrs}>
      <BaseURL>${escapeXml(url)}</BaseURL>
      <SegmentBase indexRange="${idxRange}">
        <Initialization range="${init}"/>
      </SegmentBase>
    </Representation>`;
  };

  const audioBlock = audio
    ? `<AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" lang="und">
    ${rep(audio, "audio")}
  </AdaptationSet>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${dur}S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-live:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">
      ${rep(video, "video")}
    </AdaptationSet>
    ${audioBlock}
  </Period>
</MPD>`;
}

export default function Player({
  bvid,
  cid,
  aid,
  title,
  cover,
}: {
  bvid: string;
  cid: number;
  aid: number;
  title: string;
  cover?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [data, setData] = useState<PlayUrlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const [quality, setQuality] = useState<number | null>(null);
  const [qMenu, setQMenu] = useState(false);

  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // 弹幕
  const [danmaku, setDanmaku] = useState<Danmaku[]>([]);
  const [dmEnable, setDmEnable] = useState(true);
  const [dmOpacity, setDmOpacity] = useState(1);
  const [dmScale, setDmScale] = useState(1);
  const [dmArea, setDmArea] = useState(1);
  const [dmPanel, setDmPanel] = useState(false);

  /* 拉弹幕 */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/danmaku?cid=${cid}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j?.data)) setDanmaku(j.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cid]);

  /* 拉播放地址 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFallbackUrl(null);
    setData(null);

    fetch(`/api/playurl?bvid=${bvid}&cid=${cid}&qn=127`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.code !== 0) throw new Error(j.message || "无法获取播放地址");
        const d = j.data as PlayUrlData;
        setData(d);
        const accepted = d.accept_quality ?? [];
        const support = (d.support_formats ?? []).filter((f) => accepted.includes(f.quality));
        if (support.length) {
          const suggested = support.find((f) => f.quality === d.quality);
          setQuality(suggested?.quality ?? support[support.length - 1].quality);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bvid, cid]);

  /* 初始化播放 */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !data) return;

    let destroyed = false;
    let blobUrl: string | null = null;

    const start = async () => {
      const ok = await ensureDash();
      if (destroyed) return;

      const hasDash = Boolean(data.dash?.video?.length);
      if (ok && hasDash) {
        try {
          const mpd = buildMpd(data, quality ?? data.quality, null);
          blobUrl = URL.createObjectURL(
            new Blob([mpd], { type: "application/dash+xml" }),
          );
          const player = window.dashjs!.MediaPlayer().create();
          player.updateSettings({
            streaming: { buffer: { fastSwitchEnabled: true } },
          });
          player.initialize(video, blobUrl, false);
          playerRef.current = player;
          return;
        } catch {
          /* 落到 MP4 */
        }
      }

      // 降级：请求 MP4 直链
      try {
        const res = await fetch(
          `/api/playurl?bvid=${bvid}&cid=${cid}&qn=64&mp4=1`,
          { credentials: "same-origin" },
        );
        const j = await res.json();
        const url = j?.data?.durl?.[0]?.url;
        if (!destroyed && url) {
          setFallbackUrl(url);
          video.src = url;
          video.load();
          return;
        }
      } catch {
        /* ignore */
      }
      if (!destroyed) setError("无法播放该视频（可能是会员专享或地区限制）");
    };

    start();

    return () => {
      destroyed = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, quality, bvid, cid]);

  /* 原生降级时设置 src */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !fallbackUrl) return;
    video.src = fallbackUrl;
    video.load();
  }, [fallbackUrl]);

  /* 事件绑定 */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => setCurrentTime(video.currentTime);
    const onDur = () => setDuration(video.duration || 0);
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onProgress = () => {
      if (video.buffered.length) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onDur);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("progress", onProgress);
    video.addEventListener("volumechange", onVolume);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onDur);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("volumechange", onVolume);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  /* 播放进度上报（登录后） */
  useEffect(() => {
    if (paused || !aid || !cid) return;
    const timer = setInterval(() => {
      const t = videoRef.current?.currentTime ?? 0;
      fetch("/api/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "heartbeat",
          aid,
          cid,
          playedTime: Math.floor(t),
        }),
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [paused, aid, cid]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || 0));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const qualities = useMemo(() => {
    const accepted = data?.accept_quality ?? [];
    return (data?.support_formats ?? [])
      .filter((f) => accepted.includes(f.quality))
      .map((f) => ({
        id: f.quality,
        label: `${f.new_description}${f.superscript ? ` ${f.superscript}` : ""}`,
      }));
  }, [data]);

  const currentLabel = useMemo(() => {
    if (!quality) return "自动";
    return qualities.find((q) => q.id === quality)?.label ?? "自动";
  }, [quality, qualities]);

  return (
    <div className="player-wrap" ref={wrapRef}>
      <video
        ref={videoRef}
        playsInline
        poster={cover}
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        style={{ cursor: "pointer" }}
      />

      <DanmakuLayer
        items={danmaku}
        currentTime={currentTime}
        playing={!paused}
        opacity={dmOpacity}
        fontSizeScale={dmScale}
        displayArea={dmArea}
        enable={dmEnable}
        duration={duration}
      />

      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "rgba(0,0,0,.35)",
            fontSize: 14,
          }}
        >
          加载中…
        </div>
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: 24,
            color: "#fff",
            background: "rgba(0,0,0,.6)",
            fontSize: 14,
            lineHeight: 1.8,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              无法播放：{error}
            </div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>
              试试登录 B 站账号解锁更高清晰度，或稍后再试（B 站对游客有限流）
            </div>
          </div>
        </div>
      )}

      {/* 标题（全屏时显示） */}
      {fullscreen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "14px 18px",
            background: "linear-gradient(rgba(0,0,0,.6), transparent)",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      )}

      {/* 控制条 */}
      <div className="player-bar">
        <button onClick={toggle} style={{ color: "#fff", fontSize: 15, width: 26 }}>
          {paused ? "▶" : "❚❚"}
        </button>

        <div
          style={{ flex: 1, display: "flex", alignItems: "center", cursor: "pointer", height: 18 }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: 4,
              borderRadius: 3,
              background: "rgba(255,255,255,.25)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${bufPct}%`,
                background: "rgba(255,255,255,.35)",
                borderRadius: 3,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${pct}%`,
                background: "var(--brand)",
                borderRadius: 3,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: -3,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fff",
                transform: "translateX(-50%)",
              }}
            />
          </div>
        </div>

        <span
          style={{
            color: "#fff",
            fontSize: 12.5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>

        <button
          onClick={() => setDmPanel((v) => !v)}
          style={{ color: dmEnable ? "#fff" : "#888", fontSize: 13 }}
        >
          弹
        </button>

        {qualities.length > 0 && (
          <button onClick={() => setQMenu((v) => !v)} style={{ color: "#fff", fontSize: 12.5 }}>
            {currentLabel}
          </button>
        )}

        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) v.muted = !v.muted;
          }}
          style={{ color: muted ? "#888" : "#fff", fontSize: 14 }}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = videoRef.current;
            if (!v) return;
            v.volume = Number(e.target.value);
            v.muted = Number(e.target.value) === 0;
          }}
          style={{ width: 60, accentColor: "var(--brand)" }}
        />

        <button onClick={toggleFullscreen} style={{ color: "#fff", fontSize: 14 }}>
          {fullscreen ? "⤡" : "⛶"}
        </button>
      </div>

      {qMenu && (
        <div className="qmenu">
          {qualities.map((q) => (
            <button
              key={q.id}
              className={`qmenu-item${q.id === quality ? " active" : ""}`}
              onClick={() => {
                setQuality(q.id);
                setQMenu(false);
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      {dmPanel && (
        <div className="qmenu" style={{ width: 220 }}>
          <div className="qmenu-item" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>显示弹幕</span>
            <input
              type="checkbox"
              checked={dmEnable}
              onChange={(e) => setDmEnable(e.target.checked)}
            />
          </div>
          <div className="qmenu-item">
            不透明度
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.1}
              value={dmOpacity}
              onChange={(e) => setDmOpacity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--brand)" }}
            />
          </div>
          <div className="qmenu-item">
            字号
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.1}
              value={dmScale}
              onChange={(e) => setDmScale(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--brand)" }}
            />
          </div>
          <div className="qmenu-item">
            显示区域
            <input
              type="range"
              min={0.25}
              max={1}
              step={0.25}
              value={dmArea}
              onChange={(e) => setDmArea(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--brand)" }}
            />
          </div>
          <div className="qmenu-item" style={{ opacity: 0.7, fontSize: 12 }}>
            共 {danmaku.length} 条弹幕
          </div>
        </div>
      )}
    </div>
  );
}
