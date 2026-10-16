/**
 * SmoothBili API 中转 —— 云函数版（腾讯云 SCF / 阿里云 FC / 华为云 FunctionGraph）
 *
 * ── 为什么用云函数 ──────────────────────────────────────────────
 * 免费额度大（腾讯云 SCF 100 万次/月 + 40 万 GB·s，阿里云 FC、华为云也有），
 * 关键是**出口 IP 属于云厂商的机房段**，不像 Cloudflare Workers 那样被 B 站整段拉黑。
 *
 * 架构：
 *   浏览器 → Cloudflare Workers（渲染页面，全球加速）
 *              ↓ BILI_API_PROXY_BASE
 *           云函数（本文件，干净出口 IP）
 *              ↓
 *           B 站接口
 *
 * 地域选择很重要：
 *   腾讯云 SCF → 选「中国香港」地域，出口是香港 IP
 *   阿里云 FC  → 选「中国香港」地域
 *   若只有大陆地域，出口是大陆 IP，访问 B 站同样没问题
 *
 * 注意：云函数不适合转发**视频流**（响应体太大、会撑爆内存且费用高）。
 * 视频流继续走 docs/cloudflare-worker.js。
 *
 * ── 部署（腾讯云 SCF）────────────────────────────────────────────
 *   1. 控制台 → 云函数 → 新建 → 地域选「中国香港」
 *   2. 运行环境 Node.js 18，把本文件内容粘进去
 *   3. 执行超时设 30 秒，内存 256MB 足够
 *   4. 触发方式：API 网关触发器（GET + POST 都要放行）
 *   5. 环境变量加 RELAY_TOKEN（在控制台的「环境变量」里填，别写进代码）
 *   6. 拿到 API 网关地址，填到 Workers 的 BILI_API_PROXY_BASE
 */

const https = require("https");
const http = require("http");

const TOKEN = process.env.RELAY_TOKEN;

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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

/** 腾讯云 SCF 的 event 可能是驼峰也可能是下划线，统一取 */
function getHeaders(event) {
  return event.headers || event.Headers || {};
}
function getQuery(event) {
  return (
    event.queryString ||
    event.queryStringParameters ||
    event.query ||
    event.Query ||
    {}
  );
}

function forward(targetUrl, method, headers, body) {
  return new Promise((resolve) => {
    const isHttps = targetUrl.startsWith("https:");
    const client = isHttps ? https : http;

    const req = client.request(
      targetUrl,
      { method, headers, timeout: 25000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers || {},
            body: buf,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ statusCode: 504, headers: {}, body: Buffer.from("upstream timeout") });
    });
    req.on("error", () => {
      resolve({ statusCode: 502, headers: {}, body: Buffer.from("upstream error") });
    });

    if (body) req.write(body);
    req.end();
  });
}

exports.main_handler = async (event) => {
  // 健康检查
  const path = event.path || event.requestContext?.path || "/";
  if (path === "/" && !getQuery(event).url) {
    return { statusCode: 200, headers: CORS, body: "SmoothBili relay (serverless) OK" };
  }

  if (!TOKEN) {
    return {
      statusCode: 500,
      headers: CORS,
      body: "RELAY_TOKEN 未配置，拒绝提供服务（否则等于开放免费代理）",
    };
  }

  const headers = getHeaders(event);
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  if (lower["x-relay-token"] !== TOKEN) {
    return { statusCode: 401, headers: CORS, body: "unauthorized" };
  }

  const q = getQuery(event);
  const raw = q.url || q.u;
  if (!raw) return { statusCode: 400, headers: CORS, body: "missing param url" };

  let target;
  try {
    target = new URL(raw);
  } catch {
    return { statusCode: 400, headers: CORS, body: "bad url" };
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return { statusCode: 403, headers: CORS, body: "disallowed host" };
  }

  // 透传其余查询参数（B 站鉴权参数挂在 query 上）
  for (const [k, v] of Object.entries(q)) {
    if (k !== "url" && k !== "u") target.searchParams.set(k, v);
  }

  // 构造上游请求头
  const up = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) up[k] = v;
  }
  up["User-Agent"] = UA;
  up["Referer"] = "https://www.bilibili.com/";
  up["Origin"] = "https://www.bilibili.com";
  up["Accept-Encoding"] = "identity"; // 不让上游压缩，云函数里解压麻烦

  const method = (event.httpMethod || event.method || "GET").toUpperCase();

  let body;
  if (method !== "GET" && method !== "HEAD" && event.body) {
    body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);
  }

  const res = await forward(target.toString(), method, up, body);

  // 剔除逐跳头，附加 CORS
  const respHeaders = { ...CORS };
  for (const [k, v] of Object.entries(res.headers)) {
    const lk = k.toLowerCase();
    if (["transfer-encoding", "connection", "content-length"].includes(lk)) continue;
    respHeaders[k] = v;
  }

  // 二进制（图片/字体）走 base64，文本直接返回
  const isBinary = !/^(text\/|application\/json|application\/xml)/i.test(
    respHeaders["content-type"] || "",
  );

  return {
    statusCode: res.statusCode,
    headers: respHeaders,
    body: isBinary ? res.body.toString("base64") : res.body.toString("utf-8"),
    isBase64Encoded: isBinary,
  };
};

// 阿里云 FC 入口名不同，导出一份别名
exports.handler = exports.main_handler;
