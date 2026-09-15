/**
 * SmoothBili API 中转服务器（零依赖，Node 18+）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * Cloudflare Workers / Vercel 等平台的出口 IP 段被大量爬虫滥用，
 * B 站（阿里云 WAF）对其中不少段整段拉黑，表现为：
 *   · 返回 HTML 拦截页 → JSON.parse 报 Unexpected token '<'
 *   · 返回 JSON {"message": "request was banned"}
 * 这种封禁是 IP 层面的，改 UA / Referer / 签名都无效，只能换出口 IP。
 *
 * 本服务部署在你自己的香港 / 大陆 VPS（IP 干净），
 * 让 Cloudflare 上的前端把 B 站请求先发到这里，再由这里转发给 B 站。
 *
 *   浏览器 → Cloudflare Workers（渲染页面）
 *              ↓  BILI_API_PROXY_BASE
 *           本中转服务（干净 IP）
 *              ↓
 *           B 站接口 / CDN
 *
 * ── 部署 ────────────────────────────────────────────────────────
 *   # 1. 把本文件放到 VPS 上
 *   RELAY_TOKEN=$(openssl rand -hex 24) node api-relay.js
 *
 *   # 2. 用 pm2 守护
 *   pm2 start api-relay.js --name bili-relay
 *
 *   # 3. 建议套一层 HTTPS（Nginx / Caddy），不要明文 HTTP 传输 Cookie
 *
 *   # 4. 回到 Cloudflare Workers 项目，设置环境变量（wrangler secret 或控制台）：
 *   #      BILI_API_PROXY_BASE = https://relay.你的域名.com
 *   #      BILI_API_PROXY_TOKEN = 上面生成的 RELAY_TOKEN
 *
 * ── 环境变量 ────────────────────────────────────────────────────
 *   RELAY_TOKEN  必填。调用方需在请求头带 x-relay-token，不匹配直接 401。
 *                不加这个等于开放免费代理，会被扫到并用来刷流量。
 *   PORT         可选，默认 8787。
 */

const http = require("http");
const https = require("https");

const PORT = Number(process.env.PORT) || 8787;
const TOKEN = process.env.RELAY_TOKEN;

if (!TOKEN) {
  console.error("✗ 必须设置环境变量 RELAY_TOKEN，否则任何人都能把你的服务器当免费代理");
  console.error("  生成方式：openssl rand -hex 24");
  process.exit(1);
}

// 只允许转发到 B 站自有域名，防止被当成开放代理
const ALLOWED_HOSTS = [
  /\.bilibili\.com$/,
  /\.bilibili\.tv$/,
  /\.hdslb\.com$/,
  /\.biliivideo\.com$/,
  /\.bilivideo\.com$/,
  /\.bilivideo\.cn$/,
  /\.biliimg\.com$/,
  /\.akamaized\.net$/,
  /\.biliapi\.net$/,
  /\.biliapi\.com$/,
];

// 这些头由本服务自己控制，不允许调用方覆盖
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "x-relay-token",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-ipcountry",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip",
  "true-client-ip",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "content-encoding",
  "content-length",
  "strict-transport-security",
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // 健康检查
  if (req.url === "/" || req.url === "/health") {
    return send(res, 200, "SmoothBili API relay is running\n");
  }

  // 鉴权
  if (req.headers["x-relay-token"] !== TOKEN) {
    return send(res, 401, "unauthorized\n");
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const raw = url.searchParams.get("url");
  if (!raw) return send(res, 400, "missing param url\n");

  let target;
  try {
    target = new URL(raw);
  } catch {
    return send(res, 400, "bad url\n");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return send(res, 400, "bad protocol\n");
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return send(res, 403, "disallowed host\n");
  }

  // 透传其余查询参数（B 站的鉴权参数挂在 query 上）
  url.searchParams.forEach((v, k) => {
    if (k !== "url") target.searchParams.set(k, v);
  });

  // 复制请求头，剔除代管项
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }

  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  const proxyReq = client.request(
    target.toString(),
    {
      method: req.method,
      headers,
      timeout: 30000,
    },
    (upstream) => {
      const respHeaders = {};
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) respHeaders[k] = v;
      }
      respHeaders["Access-Control-Allow-Origin"] = "*";
      respHeaders["Access-Control-Expose-Headers"] =
        "Content-Range, Content-Length, Accept-Ranges";

      res.writeHead(upstream.statusCode || 502, respHeaders);
      // 流式转发 —— 不落地、不缓冲，视频流才能正常拖动
      upstream.pipe(res);
    },
  );

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) send(res, 504, "upstream timeout\n");
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) send(res, 502, "upstream error\n");
  });

  // 转发请求体（POST 点赞 / 投币等）
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

server.listen(PORT, () => {
  console.log(`✓ SmoothBili API relay listening on :${PORT}`);
  console.log(`  token 长度 ${TOKEN.length}，白名单域名 ${ALLOWED_HOSTS.length} 组`);
});
