/** 展示层格式化 */

export function formatCount(n?: number): string {
  if (n === undefined || n === null) return "0";
  if (n < 10000) return String(n);
  if (n < 100000000) {
    const v = n / 10000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}万`;
  }
  return `${(n / 100000000).toFixed(1)}亿`;
}

export function formatDuration(sec?: number): string {
  if (!sec || sec < 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatRelativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** 图片统一走本地代理（B 站图床校验 Referer） */
export function img(url?: string, size?: string): string {
  if (!url) return "";
  let u = url.startsWith("//") ? `https:${url}` : url;
  u = u.replace(/^http:\/\//, "https://");
  if (size && !u.includes("@")) u += size.startsWith("@") ? size : `@${size}`;
  return `/api/img?u=${encodeURIComponent(u)}`;
}
