/**
 * B 站 HTTP 底层：设备指纹、WBI 密钥、鉴权 Cookie、风控重试、内存缓存。
 * 这一层保持"无业务"，只负责把请求成功发出去。
 *
 * 所有请求只在服务端（Node runtime）发起，浏览器永不直连 B 站。
 */

import { signWbi, parseWbiKeys, type Params, type WbiKeys } from "./wbi";
import { toCookieHeader, type BiliCredential } from "./session";

export const API_BASE = "https://api.bilibili.com";
export const PASSPORT_BASE = "https://passport.bilibili.com";
export const LIVE_BASE = "https://api.live.bilibili.com";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const REFERER = "https://www.bilibili.com/";

/* --------------------------- API 中转（可选） ---------------------------
 *
 * 背景：Cloudflare Workers / Vercel 等平台的出口 IP 段被大量爬虫滥用，
 * B 站（阿里云 WAF）对其中不少段是整段拉黑的，表现为：
 *   - 返回 HTML 拦截页 → JSON.parse 报 "Unexpected token '<'"
 *   - 返回 JSON {"message": "request was banned"}
 * 这类封禁是 IP 层面的，改 UA / Referer / 签名都无效。
 *
 * 解法：把 B 站请求先发到你自己那台 IP 干净的服务器（香港 / 大陆 VPS）中转。
 * 配置方式（任选其一，都不配则直连 B 站）：
 *   BILI_API_PROXY_BASE=https://relay.example.com
 *   BILI_API_PROXY_TOKEN=你的随机字符串（配合 docs/api-relay.js 使用）
 *
 * 注意：中转服务器本身也需要能访问 B 站，且必须是干净 IP。
 */

const PROXY_BASE = process.env.BILI_API_PROXY_BASE?.replace(/\/$/, "") ?? "";
const PROXY_TOKEN = process.env.BILI_API_PROXY_TOKEN ?? "";

/** 把 B 站原始 URL 包装成中转 URL（未配置时原样返回） */
export function resolveUrl(url: string): string {
  if (!PROXY_BASE) return url;
  return `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
}

/** 中转鉴权头（未配置时为空对象） */
export function proxyHeaders(): Record<string, string> {
  return PROXY_TOKEN ? { "x-relay-token": PROXY_TOKEN } : {};
}

export const usingProxy = Boolean(PROXY_BASE);

export interface BiliResponse<T = unknown> {
  code: number;
  message: string;
  ttl?: number;
  data: T;
}

/* --------------------------- 游客设备指纹 --------------------------- */

export interface GuestIdentity {
  buvid3: string;
  buvid4: string;
}

function uuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
}

let guestMemory: GuestIdentity | null = null;

export async function getGuestIdentity(): Promise<GuestIdentity> {
  if (guestMemory) return guestMemory;
  try {
    const res = await fetch(resolveUrl(`${API_BASE}/x/frontend/finger/spi`), {
      headers: { "User-Agent": UA, Referer: REFERER, ...proxyHeaders() },
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as BiliResponse<{ b_3: string; b_4: string }>;
    if (json.code === 0 && json.data?.b_3) {
      guestMemory = { buvid3: json.data.b_3, buvid4: json.data.b_4 ?? "" };
      return guestMemory;
    }
  } catch {
    /* 失败则本地生成 */
  }
  guestMemory = { buvid3: `${uuidV4()}infoc`, buvid4: `${uuidV4()}` };
  return guestMemory;
}

/* --------------------------- buvid 激活 ---------------------------
 *
 * 光拿到 buvid3 还不够 —— 必须调一次 ExClimbWuzhi 把它"激活"，
 * 否则 B 站视其为无效设备指纹。官方 collect 文档明确指出：
 * web 端点赞等操作要求存在有效的 buvid3，否则触发风控拦截。
 *
 * 这一步只需在设备指纹生成后做一次，失败也不阻塞主流程。
 */

let buvidActivated = false;

async function activateBuvid(identity: GuestIdentity, cred: BiliCredential | null) {
  if (buvidActivated) return;
  buvidActivated = true;

  const now = Date.now();
  const payload = JSON.stringify({
    "3064": 1,
    "5062": String(now),
    "03bf": encodeURIComponent(REFERER),
    "39c8": "333.1007.fp.risk",
    "34f1": "",
    d402: "",
    "654a": "",
    "6e7c": "1920x1080",
    "3c43": {
      "2673": 1,
      "5766": 24,
      "6527": 0,
      "7003": 1,
      "807e": 1,
      b8ce: UA,
    },
  });

  try {
    await fetch(resolveUrl(`${API_BASE}/x/internal/gaia-gateway/ExClimbWuzhi`), {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Referer: REFERER,
        Origin: "https://www.bilibili.com",
        "Content-Type": "application/json",
        Cookie: toCookieHeader(cred, {
          buvid3: identity.buvid3,
          buvid4: identity.buvid4,
          b_nut: String(Math.floor(now / 1000)),
        }),
        ...proxyHeaders(),
      },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* 激活失败不阻塞，请求照发 */
  }
}

/* --------------------------- bili_ticket ---------------------------
 *
 * JWT 设备票据，有效期约 3 天。官方 collect 文档：
 * "非必需，但存在可降低风控概率"。
 *
 * 算法：HMAC-SHA256(key = "XgwSnGZ1p", msg = "ts" + 秒级时间戳) → hexsign
 * 然后 POST 换 ticket。
 */

const TICKET_KEY = "XgwSnGZ1p";
let ticketMemory: { ticket: string; expire: number } | null = null;
let ticketPending: Promise<string> | null = null;

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 获取 bili_ticket（带内存缓存 + 并发去重，失败返回空串） */
export async function getBiliTicket(
  cred: BiliCredential | null,
): Promise<string> {
  if (ticketMemory && ticketMemory.expire > Date.now()) return ticketMemory.ticket;
  // 并发去重：多个请求同时首次调用时只发一次
  if (ticketPending) return ticketPending;

  ticketPending = (async () => {
    try {
      const ts = Math.floor(Date.now() / 1000);
      const hexsign = await hmacSha256Hex(TICKET_KEY, `ts${ts}`);
      const body = new URLSearchParams({
        key_id: "ec02",
        hexsign,
        "context[ts]": String(ts),
        csrf: cred?.bili_jct ?? "",
      });

      const g = await getGuestIdentity();
      const res = await fetch(
        resolveUrl(
          `${API_BASE}/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket`,
        ),
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            Referer: REFERER,
            Origin: "https://www.bilibili.com",
            "Content-Type": "application/x-www-form-urlencoded",
            // 注意：这里不能直接调 guestCookies()，
            // 否则 guestCookies → getBiliTicket → guestCookies 会无限递归
            Cookie: toCookieHeader(cred, {
              buvid3: g.buvid3,
              buvid4: g.buvid4,
              b_nut: String(ts),
            }),
            ...proxyHeaders(),
          },
          body: body.toString(),
          signal: AbortSignal.timeout(8000),
        },
      );
      const json = (await res.json()) as BiliResponse<{
        ticket?: string;
        created_at?: number;
        ttl?: number;
      }>;
      const ticket = json.data?.ticket;
      if (ticket) {
        const ttl = (json.data?.ttl ?? 259200) * 1000;
        ticketMemory = { ticket, expire: Date.now() + ttl - 60_000 };
        return ticket;
      }
    } catch {
      /* 拿不到就算了，不是必需项 */
    }
    return "";
  })();

  try {
    return await ticketPending;
  } finally {
    ticketPending = null;
  }
}

/* --------------------------- dm_img 风控参数 ---------------------------
 *
 * B 站网关对 wbi 类接口新增了 dm_img_* 参数校验，缺失时 playurl 直接返 412。
 * 这几个值描述的是浏览器 WebGL 渲染环境，服务端只校验存在性不做真实性比对，
 * 因此使用公开常量即可（与 yt-dlp 等开源实现一致）。
 *
 * 注意：登录状态下应改为 dm_img_switch=0 并不需要这些参数，
 * 所以仅在未登录时注入。
 */

export const DM_IMG = {
  list: "[]",
  str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
  coverStr:
    "QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwICgweDAwMDAzRTk4KSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzAsIEQzRDExKUdvb2dsZSBJbmMuIChJbnRlbC",
  inter: '{"ds":[],"wh":[2332,-136,36],"of":[130,260,130]}',
} as const;

/** 未登录时给参数补上 dm_img 系列风控字段 */
export function withDmImg(
  params: Params,
  cred: BiliCredential | null,
): Params {
  if (cred?.SESSDATA) return { ...params, dm_img_switch: 0 };
  return {
    ...params,
    dm_img_list: DM_IMG.list,
    dm_img_str: DM_IMG.str,
    dm_cover_img_str: DM_IMG.coverStr,
    dm_img_inter: DM_IMG.inter,
  };
}

/* ----------------------------- WBI 密钥 ----------------------------- */

let wbiMemory: { keys: WbiKeys; at: number } | null = null;
const WBI_TTL_MS = 2 * 60 * 60 * 1000;

async function fetchWbiKeys(cred: BiliCredential | null): Promise<WbiKeys> {
  const res = await fetch(resolveUrl(`${API_BASE}/x/web-interface/nav`), {
    headers: {
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: toCookieHeader(cred, await guestCookies(cred)),
      ...proxyHeaders(),
    },
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as BiliResponse<{
    wbi_img?: { img_url: string; sub_url: string };
  }>;
  const img = json.data?.wbi_img?.img_url;
  const sub = json.data?.wbi_img?.sub_url;
  if (!img || !sub) throw new Error("无法获取 WBI 密钥");
  return parseWbiKeys(img, sub);
}

export async function getWbiKeys(cred: BiliCredential | null): Promise<WbiKeys> {
  if (wbiMemory && Date.now() - wbiMemory.at < WBI_TTL_MS) return wbiMemory.keys;
  const keys = await fetchWbiKeys(cred);
  wbiMemory = { keys, at: Date.now() };
  return keys;
}

export function dropWbiKeys(): void {
  wbiMemory = null;
}

async function guestCookies(
  cred: BiliCredential | null = null,
): Promise<Record<string, string>> {
  const g = await getGuestIdentity();
  // 首次拿到指纹后触发一次激活（异步、不阻塞）
  if (!buvidActivated) void activateBuvid(g, cred);

  const cookies: Record<string, string> = {
    buvid3: g.buvid3,
    buvid4: g.buvid4,
    b_nut: String(Math.floor(Date.now() / 1000)),
    b_lsid: `${uuidV4().replace(/-/g, "").slice(0, 16)}_${uuidV4()
      .replace(/-/g, "")
      .slice(0, 16)}`,
    buvid_fp: uuidV4().replace(/-/g, "").toLowerCase().slice(0, 32),
    CURRENT_FNVAL: "4048",
    home_feed_column: "5",
    browser_resolution: "1920-1080",
  };

  // bili_ticket：非必需但能降低风控概率
  const ticket = await getBiliTicket(cred);
  if (ticket) cookies.bili_ticket = ticket;

  return cookies;
}

/* ----------------------------- 缓存 ----------------------------- */

type CacheEntry = { value: unknown; expire: number };
const memCache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expire < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: unknown, ttl: number) {
  memCache.set(key, { value, expire: Date.now() + ttl * 1000 });
  // 简单容量控制
  if (memCache.size > 3000) {
    const now = Date.now();
    for (const [k, v] of memCache) if (v.expire < now) memCache.delete(k);
  }
}

/* ----------------------------- 核心请求 ----------------------------- */

export interface BiliFetchOptions {
  wbi?: boolean;
  /** 缓存秒数，0 = 不缓存 */
  cacheTtl?: number;
  cred?: BiliCredential | null;
  extraCookies?: Record<string, string>;
  referer?: string;
  timeout?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: URLSearchParams | string;
}

const NEVER_CACHE = [/login/i, /\/nav/i, /history/i, /relation/i, /heartbeat/i, /playurl/i];

function defaultTtl(url: string, method: string): number {
  if (method !== "GET") return 0;
  if (NEVER_CACHE.some((re) => re.test(url))) return 0;
  return 60;
}

export class BiliError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = "BiliError";
  }
}

/** 请求 B 站，返回原始 JSON（不做 code 判定） */
export async function biliFetchRaw<T = unknown>(
  url: string,
  params: Params = {},
  opts: BiliFetchOptions = {},
): Promise<BiliResponse<T>> {
  const method = opts.method ?? "GET";
  const cred = opts.cred ?? null;
  const ttl = opts.cacheTtl ?? defaultTtl(url, method);

  const doRequest = async (): Promise<BiliResponse<T>> => {
    const baseCookies = {
      ...(await guestCookies(cred)),
      ...(opts.extraCookies ?? {}),
    };
    const query = new URLSearchParams();

    if (opts.wbi) {
      const keys = await getWbiKeys(cred);
      // 未登录时补 dm_img 风控参数，缺失会被网关判 412
      const signed = signWbi(withDmImg(params, cred), keys);
      signed.forEach((v, k) => query.set(k, v));
    } else {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        query.set(k, String(v));
      }
    }

    let finalUrl = url;
    if (method === "GET") {
      const qs = query.toString();
      if (qs) finalUrl += (url.includes("?") ? "&" : "?") + qs;
    }

    const res = await fetch(resolveUrl(finalUrl), {
      method,
      headers: {
        "User-Agent": UA,
        Referer: opts.referer ?? REFERER,
        Origin: "https://www.bilibili.com",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Cookie: toCookieHeader(cred, baseCookies),
        ...proxyHeaders(),
        ...(opts.headers ?? {}),
      },
      ...(method === "POST"
        ? {
            body:
              opts.body instanceof URLSearchParams
                ? opts.body.toString()
                : String(opts.body ?? ""),
          }
        : {}),
      signal: AbortSignal.timeout(opts.timeout ?? 12000),
    });

    const text = await res.text();
    try {
      return JSON.parse(text) as BiliResponse<T>;
    } catch {
      return {
        code: -1,
        message: `非 JSON 响应（HTTP ${res.status}）`,
        data: null as T,
      };
    }
  };

  if (ttl <= 0) {
    const res = await doRequest();
    // -352 / -403：风控或签名过期 → 丢弃密钥重试一次
    if (res.code === -352 || res.code === -403) {
      dropWbiKeys();
      return doRequest();
    }
    return res;
  }

  const cacheKey = `bili:${method}:${url}:${JSON.stringify(params)}:${
    cred?.DedeUserID ?? "0"
  }`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached as BiliResponse<T>;

  let res = await doRequest();
  if (res.code === -352 || res.code === -403) {
    dropWbiKeys();
    res = await doRequest();
  }
  // 只缓存成功的响应
  if (res.code === 0) cacheSet(cacheKey, res, ttl);
  return res;
}

/** 业务主入口：code === 0 返回 data，否则抛错 */
export async function biliFetch<T = unknown>(
  url: string,
  params: Params = {},
  opts: BiliFetchOptions = {},
): Promise<T> {
  const res = await biliFetchRaw<T>(url, params, opts);
  if (res.code !== 0) {
    throw new BiliError(res.code, res.message || "B 站接口返回错误");
  }
  return res.data;
}
