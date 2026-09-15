/**
 * SmoothBili 视频流代理 —— Cloudflare Worker 版
 *
 * 为什么需要它：
 *   B 站 CDN 校验 Referer，浏览器直连会 403，所以视频流必须走服务端代理。
 *   但 Vercel 等 Serverless 平台有「函数超时」与「带宽额度」双重限制，
 *   视频流这种长连接大流量场景很容易把额度烧光。
 *   Cloudflare Workers 不计费带宽、流式转发几乎不消耗 CPU 时间，是更合适的选择。
 *
 * 部署步骤：
 *   1. 打开 Cloudflare 控制台 → Workers 和 Pages → 创建应用程序 → 创建 Worker
 *   2. 把本文件内容全部粘贴进编辑器，点「部署」
 *   3. 复制得到的地址（形如 https://smoothbili-proxy.xxx.workers.dev）
 *   4. 回到 Vercel 项目 → Settings → Environment Variables，新增：
 *        变量名 PLAYBACK_PROXY_BASE
 *        值     https://smoothbili-proxy.xxx.workers.dev
 *   5. 重新部署（Deployments → 最新一条 → Redeploy）
 *
 * 安全提示：
 *   本 Worker 只转发 B 站自有 CDN 域名（白名单见 ALLOWED_HOSTS）。
 *   请勿移除白名单校验，否则你的 Worker 会被当成公开免费代理滥用，
 *   轻则被 Cloudflare 限流，重则封号。
 */

// 只允许 B 站自有 CDN 域名，防止被当作开放代理
const ALLOWED_HOSTS = [
  /\.hdslb\.com$/,
  /\.biliivideo\.com$/,
  /\.bilivideo\.com$/,
  /\.bilivideo\.cn$/,
  /\.bilibili\.com$/,
  /\.akamaized\.net$/,
  /\.biliapi\.net$/,
  /\.biliapi\.com$/,
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export default {
  async fetch(request) {
    // 允许跨域（播放器在另一个域名下）
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get("u");
    if (!raw) return new Response("missing param u", { status: 400 });

    // 支持明文 URL 或 base64 编码
    let candidate = raw;
    if (!/^https?:\/\//i.test(candidate)) {
      try {
        candidate = atob(candidate.replace(/-/g, "+").replace(/_/g, "/"));
      } catch {
        return new Response("bad url", { status: 400 });
      }
    }

    let target;
    try {
      target = new URL(candidate);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
      return new Response("disallowed host", { status: 403 });
    }

    // 透传其余查询参数（B 站的鉴权参数挂在 query 上）
    url.searchParams.forEach((v, k) => {
      if (k !== "u") target.searchParams.set(k, v);
    });

    // 构造上游请求头，必须带 Referer 才能过 CDN 校验
    const headers = new Headers({
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
      Accept: "*/*",
    });

    // 透传 Range —— 不做这一步就无法拖动进度条
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    const ifRange = request.headers.get("If-Range");
    if (ifRange) headers.set("If-Range", ifRange);

    let upstream;
    try {
      upstream = await fetch(target.toString(), { headers, redirect: "follow" });
    } catch {
      return new Response("upstream error", { status: 502 });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`upstream ${upstream.status}`, { status: 502 });
    }

    const respHeaders = new Headers();
    for (const h of [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "ETag",
      "Last-Modified",
    ]) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set(
      "Access-Control-Expose-Headers",
      "Content-Range, Content-Length, Accept-Ranges",
    );
    respHeaders.set("Cache-Control", "public, max-age=3600");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  },
};
