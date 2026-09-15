"use client";

/** 弹幕层：Canvas 绘制，零依赖，支持滚动 / 顶部 / 底部三种模式 */

import { useEffect, useRef } from "react";
import type { Danmaku } from "@/lib/types";

interface Active {
  item: Danmaku;
  x: number;
  y: number;
  width: number;
  speed: number;
  mode: number;
  born: number;
}

export default function DanmakuLayer({
  items,
  currentTime,
  playing,
  opacity = 1,
  fontSizeScale = 1,
  displayArea = 1,
  enable = true,
  duration = 0,
}: {
  items: Danmaku[];
  currentTime: number;
  playing: boolean;
  opacity?: number;
  fontSizeScale?: number;
  displayArea?: number;
  enable?: boolean;
  duration?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const activesRef = useRef<Active[]>([]);
  const cursorRef = useRef(0);
  const lastTsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef(currentTime);
  const playingRef = useRef(playing);
  const itemsRef = useRef(items);
  const cfgRef = useRef({ opacity, fontSizeScale, displayArea, enable });

  timeRef.current = currentTime;
  playingRef.current = playing;
  itemsRef.current = items;
  cfgRef.current = { opacity, fontSizeScale, displayArea, enable };

  // 时间大幅回退（拖动进度条）时重置弹幕队列
  useEffect(() => {
    if (currentTime < timeRef.current - 1 || currentTime < 0.5) {
      activesRef.current = [];
      cursorRef.current = 0;
      const sorted = itemsRef.current;
      while (
        cursorRef.current < sorted.length &&
        sorted[cursorRef.current].time < currentTime
      ) {
        cursorRef.current++;
      }
    }
  }, [currentTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // 轨道管理：避免弹幕重叠
    let tracks: number[] = [];

    const spawn = (item: Danmaku) => {
      const { fontSizeScale: fs, displayArea: area } = cfgRef.current;
      const fontSize = Math.max(12, (item.size || 25) * 0.8 * fs);
      ctx.font = `600 ${fontSize}px sans-serif`;
      const width = ctx.measureText(item.text).width;
      const W = canvas.width;
      const H = canvas.height;
      const usableH = H * Math.min(1, Math.max(0.25, area));
      const lineH = fontSize * 1.35;
      const trackCount = Math.max(1, Math.floor(usableH / lineH));

      if (tracks.length !== trackCount) tracks = new Array(trackCount).fill(-1e9);

      const mode = item.mode;
      if (mode === 4 || mode === 5) {
        // 底部 / 顶部固定
        const isBottom = mode === 4;
        let lane = 0;
        for (let i = 0; i < trackCount; i++) {
          const idx = isBottom ? trackCount - 1 - i : i;
          if (timeRef.current - tracks[idx] > 4) {
            lane = idx;
            break;
          }
        }
        tracks[lane] = timeRef.current;
        return {
          item,
          x: (W - width) / 2,
          y: lane * lineH + fontSize,
          width,
          speed: 0,
          mode,
          born: timeRef.current,
        } as Active;
      }

      // 滚动
      let lane = -1;
      for (let i = 0; i < trackCount; i++) {
        if (timeRef.current - tracks[i] > 0.2 && tracks[i] !== -1e9) {
          const lastW = 0; // 简化：按时间间隔判定即可
          void lastW;
          lane = i;
          break;
        }
        if (tracks[i] === -1e9) {
          lane = i;
          break;
        }
      }
      if (lane === -1) return null;
      tracks[lane] = timeRef.current;

      return {
        item,
        x: W,
        y: lane * lineH + fontSize,
        width,
        speed: (W + width) / 8, // 8 秒走完
        mode: 1,
        born: timeRef.current,
      } as Active;
    };

    const render = (ts: number) => {
      rafRef.current = requestAnimationFrame(render);
      const last = lastTsRef.current || ts;
      const dt = Math.min(0.1, (ts - last) / 1000);
      lastTsRef.current = ts;

      const cfg = cfgRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!cfg.enable) {
        activesRef.current = [];
        return;
      }

      const list = itemsRef.current;
      // 补充新弹幕（基于播放时间）
      if (playingRef.current) {
        let guard = 0;
        while (
          cursorRef.current < list.length &&
          list[cursorRef.current].time <= timeRef.current &&
          guard < 300
        ) {
          const a = spawn(list[cursorRef.current]);
          if (a) activesRef.current.push(a);
          cursorRef.current++;
          guard++;
        }
      }

      const W = canvas.width;
      const H = canvas.height;
      const next: Active[] = [];
      for (const a of activesRef.current) {
        if (a.mode === 1) a.x -= a.speed * dt;
        const alive =
          a.mode === 1
            ? a.x + a.width > -10
            : timeRef.current - a.born < 5 && (!duration || true);
        if (!alive) continue;
        next.push(a);

        const { fontSizeScale: fs, opacity: op } = cfg;
        const fontSize = Math.max(12, (a.item.size || 25) * 0.8 * fs);
        ctx.globalAlpha = op;
        ctx.font = `600 ${fontSize}px sans-serif`;
        ctx.fillStyle = `#${(a.item.color || 0xffffff).toString(16).padStart(6, "0")}`;
        ctx.shadowColor = "rgba(0,0,0,.75)";
        ctx.shadowBlur = 3;
        ctx.fillText(a.item.text, a.x, a.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      activesRef.current = next;
      void H;
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [duration]);

  return (
    <div className="danmaku-layer" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
