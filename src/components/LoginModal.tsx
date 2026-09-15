"use client";

/**
 * 登录弹窗：扫码登录为主，手动粘贴 Cookie 为兜底。
 * 二维码在本地用 qrcode（CDN 动态加载）生成，避免额外依赖。
 */

import { useEffect, useRef, useState } from "react";

type Status = "loading" | "pending" | "scanned" | "expired" | "error" | "success";

export default function LoginModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: (u: { mid: string; uname: string; face: string; level?: number }) => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("正在获取二维码…");
  const [tab, setTab] = useState<"qr" | "cookie">("qr");
  const keyRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const [cookieText, setCookieText] = useState("");
  const [cookieBusy, setCookieBusy] = useState(false);

  const start = async () => {
    setStatus("loading");
    setMessage("正在获取二维码…");
    try {
      const res = await fetch("/api/login/qrcode", { credentials: "same-origin" });
      const json = await res.json();
      const key = json?.data?.qrcode_key;
      const url = json?.data?.url;
      if (!key || !url) throw new Error(json?.message || "获取失败");
      keyRef.current = key;

      // 动态加载 qrcode 生成库（仅登录时需要）
      const { default: QRCode } = await import("qrcode");
      const png = await QRCode.toDataURL(url, {
        margin: 0,
        width: 400,
        color: { dark: "#18191c", light: "#ffffff" },
      });
      setDataUrl(png);
      setStatus("pending");
      setMessage("打开 B 站 App 扫码登录");
      poll(key);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "二维码获取失败");
    }
  };

  const poll = async (key: string) => {
    for (let i = 0; i < 120; i++) {
      if (stoppedRef.current) return;
      await new Promise((r) => setTimeout(r, 1500));
      if (stoppedRef.current || keyRef.current !== key) return;
      try {
        const res = await fetch(
          `/api/login/poll?qrcode_key=${encodeURIComponent(key)}`,
          { credentials: "same-origin" },
        );
        const json = await res.json();
        if (json?.status === "success") {
          setStatus("success");
          setMessage("登录成功");
          setTimeout(() => onSuccess?.(json.user), 400);
          return;
        }
        if (json?.status === "expired") {
          setStatus("expired");
          setMessage("二维码已失效");
          return;
        }
        if (json?.status === "scanned") {
          setStatus("scanned");
          setMessage("已扫码，请在设备上确认");
        } else if (json?.status === "error") {
          setStatus("error");
          setMessage(json?.message || "登录失败");
          return;
        } else {
          setStatus("pending");
          setMessage("等待扫码…");
        }
      } catch {
        /* 网络抖动继续重试 */
      }
    }
    setStatus("expired");
    setMessage("二维码已超时，请点击刷新");
  };

  useEffect(() => {
    stoppedRef.current = false;
    if (tab === "qr") start();
    return () => {
      stoppedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const submitCookie = async () => {
    if (!cookieText.trim()) return;
    setCookieBusy(true);
    try {
      const res = await fetch("/api/login/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ cookie: cookieText }),
      });
      const json = await res.json();
      if (json?.status === "success") {
        setMessage("导入成功");
        setTimeout(() => onSuccess?.(json.user), 300);
      } else {
        setStatus("error");
        setMessage(json?.message || "导入失败");
      }
    } catch {
      setStatus("error");
      setMessage("网络错误");
    } finally {
      setCookieBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>登录 B 站账号</span>
          <button onClick={onClose} style={{ color: "var(--text-dim)" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 18px 0" }}>
          <button
            className={`chip${tab === "qr" ? " active" : ""}`}
            onClick={() => setTab("qr")}
          >
            扫码登录
          </button>
          <button
            className={`chip${tab === "cookie" ? " active" : ""}`}
            onClick={() => setTab("cookie")}
          >
            粘贴 Cookie
          </button>
        </div>

        <div className="modal-body">
          {tab === "qr" ? (
            <>
              {dataUrl ? (
                <div className="qr-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dataUrl} alt="登录二维码" width={200} height={200} />
                </div>
              ) : (
                <div
                  style={{
                    width: 220,
                    height: 220,
                    borderRadius: 12,
                    background: "var(--bg-elev-2)",
                  }}
                />
              )}
              <div
                className="qr-status"
                style={
                  status === "error" || status === "expired"
                    ? { color: "#ff6b6b" }
                    : undefined
                }
              >
                {message}
              </div>
              {(status === "expired" || status === "error") && (
                <button className="btn btn-primary" onClick={start}>
                  刷新二维码
                </button>
              )}
            </>
          ) : (
            <>
              <textarea
                className="cookie-input"
                placeholder={
                  "在 bilibili.com 登录后，从浏览器开发者工具复制 Cookie，粘贴到这里\n\n需要包含 SESSDATA、bili_jct、DedeUserID 三项"
                }
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
              />
              {status === "error" && (
                <div className="qr-status" style={{ color: "#ff6b6b" }}>
                  {message}
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={submitCookie}
                disabled={cookieBusy || !cookieText.trim()}
              >
                {cookieBusy ? "导入中…" : "导入并登录"}
              </button>
            </>
          )}

          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-faint)",
              textAlign: "center",
              lineHeight: 1.7,
            }}
          >
            凭据经 AES-GCM 加密后只存在你自己的浏览器 Cookie 中，
            <br />
            服务端不落库、不记录、不共享。用于解锁更高清晰度与个人数据。
          </div>
        </div>
      </div>
    </div>
  );
}
