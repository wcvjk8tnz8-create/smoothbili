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
    const res = await fetch(`${API_BASE}/x/frontend/finger/spi`, {
      headers: { "User-Agent": UA, Referer: REFERER },
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

/* ----------------------------- WBI 密钥 ----------------------------- */

let wbiMemory: { keys: WbiKeys; at: number } | null = null;
const WBI_TTL_MS = 2 * 60 * 60 * 1000;

async function fetchWbiKeys(cred: BiliCredential | null): Promise<WbiKeys> {
  const res = await fetch(`${API_BASE}/x/web-interface/nav`, {
    headers: {
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: toCookieHeader(cred, await guestCookies()),
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

async function guestCookies(): Promise<Record<string, string>> {
  const g = await getGuestIdentity();
  return {
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
    const baseCookies = { ...(await guestCookies()), ...(opts.extraCookies ?? {}) };
    const query = new URLSearchParams();

    if (opts.wbi) {
      const keys = await getWbiKeys(cred);
      const signed = signWbi(params, keys);
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

    const res = await fetch(finalUrl, {
      method,
      headers: {
        "User-Agent": UA,
        Referer: opts.referer ?? REFERER,
        Origin: "https://www.bilibili.com",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Cookie: toCookieHeader(cred, baseCookies),
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
