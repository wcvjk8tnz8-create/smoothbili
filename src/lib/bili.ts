/**
 * B 站业务接口封装（接口形态参考 piliplus / bilibili-API-collect）
 *
 * 约定：
 *  - 全部走服务端请求，浏览器永不直连 B 站 API
 *  - 需要 WBI 的接口统一标记 wbi: true
 *  - 每个函数接受可选 BiliCredential，传入即以登录态请求
 */

import {
  API_BASE,
  PASSPORT_BASE,
  biliFetch,
  getGuestIdentity,
  resolveUrl,
  proxyHeaders,
  UA,
  REFERER,
} from "./bilibase";
import type { BiliCredential } from "./session";
import type {
  CommentItem,
  Danmaku,
  PlayUrlData,
  VideoItem,
  VideoPage,
} from "./types";

/* ------------------------ 首页推荐 / 热门 / 排行 ------------------------ */

interface RcmdItem {
  bvid: string;
  cid: number;
  pic: string;
  title: string;
  duration: number;
  pubdate?: number;
  owner: { mid: number; name: string; face: string };
  stat: { view: number; danmaku: number; like: number };
  rcmd_reason?: { content?: string };
}

export async function getRecommend(
  cred: BiliCredential | null,
  freshIdx = 0,
  ps = 30,
): Promise<VideoItem[]> {
  const data = await biliFetch<{ item: RcmdItem[] }>(
    `${API_BASE}/x/web-interface/wbi/index/top/feed/rcmd`,
    {
      fresh_type: 4,
      feed_version: "V8",
      fresh_idx: freshIdx,
      fresh_idx_1h: freshIdx,
      ps,
      web_location: 1430654,
    },
    { wbi: true, cred, cacheTtl: 0 },
  );
  return (data.item ?? []).map((it) => ({
    bvid: it.bvid,
    cid: it.cid,
    title: it.title,
    pic: it.pic,
    duration: it.duration,
    owner: it.owner,
    stat: it.stat,
    rcmd_reason: it.rcmd_reason,
    pubdate: it.pubdate,
  }));
}

export async function getPopular(
  cred: BiliCredential | null,
  pn = 1,
  ps = 30,
): Promise<VideoItem[]> {
  const data = await biliFetch<{ list: VideoItem[] }>(
    `${API_BASE}/x/web-interface/popular`,
    { pn, ps },
    { cred, cacheTtl: 120 },
  );
  return data.list ?? [];
}

export async function getRanking(
  rid = 0,
  type: "all" | "origin" | "rookie" = "all",
  cred: BiliCredential | null = null,
) {
  return biliFetch(`${API_BASE}/x/web-interface/ranking/v2`, { rid, type }, {
    cred,
    cacheTtl: 300,
  });
}

/* ------------------------------ 搜索 ------------------------------ */

export interface SearchParams {
  keyword: string;
  page?: number;
  order?: "totalrank" | "click" | "pubdate" | "dm" | "stow";
  duration?: number;
  searchType?: "video" | "bili_user" | "media_bangumi" | "media_ft";
}

export async function search(p: SearchParams, cred: BiliCredential | null) {
  return biliFetch<{ result: unknown[]; numPages: number; numResults: number }>(
    `${API_BASE}/x/web-interface/wbi/search/type`,
    {
      search_type: p.searchType ?? "video",
      keyword: p.keyword,
      page: p.page ?? 1,
      order: p.order ?? "totalrank",
      ...(p.duration ? { duration: p.duration } : {}),
    },
    { wbi: true, cred, cacheTtl: 120 },
  );
}

/** 搜索建议（用于顶部搜索框下拉） */
export async function searchSuggest(term: string) {
  const data = await biliFetch<{ result?: { tag?: Array<{ value: string }> } }>(
    "https://s.search.bilibili.com/main/suggest",
    { term },
    { cacheTtl: 600, referer: REFERER, headers: { Origin: "https://www.bilibili.com" } },
  );
  return (data?.result?.tag ?? []).map((t) => t.value).slice(0, 10);
}

/** 热搜榜 */
export async function hotSearch() {
  const data = await biliFetch<{
    trending?: { list?: Array<{ keyword: string; show_name: string }> };
  }>(`${API_BASE}/x/web-interface/search/square`, { limit: 20 }, { cacheTtl: 900 });
  return data?.trending?.list ?? [];
}

/* ---------------------------- 视频详情 ---------------------------- */

export async function getVideoInfo(
  bvid: string,
  cred: BiliCredential | null,
): Promise<VideoPage> {
  return biliFetch<VideoPage>(
    `${API_BASE}/x/web-interface/view`,
    { bvid },
    {
      cred,
      referer: `https://www.bilibili.com/video/${bvid}`,
      cacheTtl: 120,
    },
  );
}

export interface PlayUrlOptions {
  bvid: string;
  cid: number;
  qn?: number;
  fnval?: number;
}

/** 视频流地址（WBI）。登录后可拿更高清晰度。 */
export async function getPlayUrl(
  o: PlayUrlOptions,
  cred: BiliCredential | null,
): Promise<PlayUrlData> {
  return biliFetch<PlayUrlData>(
    `${API_BASE}/x/player/wbi/playurl`,
    {
      bvid: o.bvid,
      cid: o.cid,
      qn: o.qn ?? 127,
      fnval: o.fnval ?? 4048,
      fourk: 1,
      voice_balance: 1,
      otype: "json",
    },
    {
      wbi: true,
      cred,
      referer: `https://www.bilibili.com/video/${o.bvid}`,
      cacheTtl: 0,
    },
  );
}

/* ------------------------------ 弹幕 ------------------------------ */

/** XML 弹幕接口：无需额外依赖，解析成本极低 */
export async function getDanmaku(
  cid: number,
  cred: BiliCredential | null,
): Promise<Danmaku[]> {
  const guest = await getGuestIdentity();
  const res = await fetch(resolveUrl(`${API_BASE}/x/v1/dm/list.so?oid=${cid}`), {
    headers: {
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: cred
        ? `SESSDATA=${cred.SESSDATA}; DedeUserID=${cred.DedeUserID}; bili_jct=${cred.bili_jct}`
        : `buvid3=${guest.buvid3}`,
      ...proxyHeaders(),
    },
    signal: AbortSignal.timeout(12000),
  });
  const xml = await res.text();
  const list: Danmaku[] = [];
  const re = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const p = m[1].split(",");
    list.push({
      time: parseFloat(p[0]) || 0,
      mode: parseInt(p[1], 10) || 1,
      size: parseInt(p[2], 10) || 25,
      color: parseInt(p[3], 10) || 0xffffff,
      timestamp: parseInt(p[4], 10) || 0,
      pool: parseInt(p[5], 10) || 0,
      midHash: p[6] ?? "",
      dbId: p[7] ?? "",
      text: decodeEntities(m[2]),
    });
  }
  return list;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/* ------------------------------ 评论 ------------------------------ */

export async function getComments(
  oid: number,
  opts: { sort?: number; page?: number; ps?: number } = {},
  cred: BiliCredential | null = null,
): Promise<{ replies: CommentItem[]; count: number; isEnd: boolean }> {
  const sort = opts.sort ?? 2;
  const page = opts.page ?? 1;
  const ps = opts.ps ?? 20;
  const data = await biliFetch<{
    replies?: CommentItem[];
    page?: { count: number };
  }>(
    `${API_BASE}/x/v2/reply/wbi/main`,
    { type: 1, oid, sort, pn: page, ps, web_location: 1315875 },
    { wbi: true, cred, cacheTtl: 60 },
  );
  return {
    replies: data.replies ?? [],
    count: data.page?.count ?? 0,
    isEnd: (data.replies?.length ?? 0) < ps,
  };
}

/* ------------------------------ UP 主 ------------------------------ */

export async function getCard(mid: number, cred: BiliCredential | null) {
  const data = await biliFetch<{
    card: { mid: number; name: string; face: string; fans: number; sign: string };
    following: boolean;
    archive_count: number;
  }>(`${API_BASE}/x/web-interface/card`, { mid, photo: false }, { cred, cacheTtl: 300 });
  return data;
}

export async function getSpaceArchives(
  mid: number,
  opts: { pn?: number; ps?: number; keyword?: string; order?: string } = {},
  cred: BiliCredential | null = null,
) {
  return biliFetch<{ list: { vlist: VideoItem[] }; page: { count: number } }>(
    `${API_BASE}/x/space/wbi/arc/search`,
    {
      mid,
      ps: opts.ps ?? 30,
      tid: 0,
      pn: opts.pn ?? 1,
      keyword: opts.keyword ?? "",
      order: opts.order ?? "pubdate",
      platform: "web",
      web_location: 1550101,
    },
    { wbi: true, cred, cacheTtl: 120 },
  );
}

/* ---------------------------- 用户信息 ---------------------------- */

export async function getMyInfo(cred: BiliCredential) {
  const data = await biliFetch<{
    mid: number;
    uname: string;
    face: string;
    isLogin: boolean;
    level_info?: { current_level: number };
  }>(`${API_BASE}/x/web-interface/nav`, {}, { cred, cacheTtl: 0 });
  return {
    mid: data.mid,
    name: data.uname,
    face: data.face,
    level: data.level_info?.current_level ?? 0,
    isLogin: data.isLogin,
  };
}

/* ---------------------------- 登录相关 ---------------------------- */

export interface QrcodeGenerate {
  url: string;
  qrcode_key: string;
}

export async function generateLoginQrcode(): Promise<QrcodeGenerate> {
  return biliFetch<QrcodeGenerate>(
    `${PASSPORT_BASE}/x/passport-login/web/qrcode/generate`,
    { source: "main-fe-header" },
    { cacheTtl: 0, referer: REFERER },
  );
}

export type QrcodePollResult =
  | { status: "pending" | "scanned" | "expired" | "error"; message: string }
  | {
      status: "success";
      credential: Omit<BiliCredential, "exp"> & { buvid3: string };
      refreshToken: string;
      expires: number;
    };

function parseCallbackCookies(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    new URL(url).searchParams.forEach((v, k) => {
      out[k] = v;
    });
  } catch {
    /* ignore */
  }
  return out;
}

export async function pollLoginQrcode(
  qrcodeKey: string,
  buvid3: string,
): Promise<QrcodePollResult> {
  const res = await biliFetchRawData<{
    url: string;
    refresh_token: string;
    code: number;
    message: string;
  }>(
    `${PASSPORT_BASE}/x/passport-login/web/qrcode/poll`,
    { qrcode_key: qrcodeKey, source: "main-fe-header" },
  );

  const bizCode = res.data?.code ?? res.code;
  const message = res.data?.message ?? res.message;

  if (bizCode === 86038) return { status: "expired", message: message || "二维码已失效" };
  if (bizCode === 86090) return { status: "scanned", message: message || "已扫码，请在 App 中确认" };
  if (bizCode === 86039) return { status: "pending", message: message || "等待扫码" };
  if (bizCode !== 0) return { status: "error", message: message || "登录失败" };

  const cookies = parseCallbackCookies(res.data?.url ?? "");
  if (!cookies.SESSDATA || !cookies.DedeUserID) {
    return { status: "error", message: "登录成功但未取到 Cookie" };
  }

  return {
    status: "success",
    credential: {
      DedeUserID: cookies.DedeUserID,
      DedeUserID__ckMd5: cookies.DedeUserID__ckMd5 ?? "",
      SESSDATA: cookies.SESSDATA,
      bili_jct: cookies.bili_jct ?? "",
      buvid3,
      isLogin: true,
    },
    refreshToken: res.data?.refresh_token ?? "",
    expires: 25 * 24 * 60 * 60, // SESSDATA 有效期约 30 天，保守取 25 天
  };
}

/** 该接口的业务状态在 data.code 上，需要拿原始响应 */
async function biliFetchRawData<T>(url: string, params: Record<string, string>) {
  const { biliFetchRaw } = await import("./bilibase");
  return biliFetchRaw<T>(url, params, {
    cacheTtl: 0,
    referer: REFERER,
    extraCookies: {},
  });
}

/* ------------------------------ 互动 ------------------------------ */

export async function interact(
  action: "like" | "coin" | "fav" | "triple",
  o: { aid: number; like?: 0 | 1; multiply?: 1 | 2; addMediaIds?: number[] },
  cred: BiliCredential,
) {
  const endpoints: Record<string, string> = {
    like: `${API_BASE}/x/web-interface/archive/like`,
    coin: `${API_BASE}/x/web-interface/coin/add`,
    fav: `${API_BASE}/x/v3/fav/resource/deal`,
    triple: `${API_BASE}/x/web-interface/archive/like/triple`,
  };
  const body = new URLSearchParams({
    aid: String(o.aid),
    csrf: cred.bili_jct,
  });
  if (action === "like") body.set("like", String(o.like ?? 1));
  if (action === "coin") {
    body.set("multiply", String(o.multiply ?? 1));
    body.set("select_like", "0");
  }
  if (action === "fav") {
    body.set("rid", String(o.aid));
    body.set("type", "2");
    body.set("add_media_ids", (o.addMediaIds ?? []).join(","));
  }

  const { biliFetchRaw } = await import("./bilibase");
  return biliFetchRaw(endpoints[action], {}, {
    method: "POST",
    body,
    cred,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    referer: `https://www.bilibili.com/video/av${o.aid}`,
  });
}

export async function reportHeartbeat(
  o: { aid: number; cid: number; playedTime?: number },
  cred: BiliCredential,
) {
  const body = new URLSearchParams({
    aid: String(o.aid),
    cid: String(o.cid),
    played_time: String(o.playedTime ?? 0),
    realtime: String(o.playedTime ?? 0),
    type: "3",
    dt: "2",
    play_type: "1",
    start_ts: String(Math.floor(Date.now() / 1000)),
    csrf: cred.bili_jct,
  });
  await fetch(resolveUrl(`${API_BASE}/x/click-interface/web/heartbeat`), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: `SESSDATA=${cred.SESSDATA}; bili_jct=${cred.bili_jct}; DedeUserID=${cred.DedeUserID}`,
      ...proxyHeaders(),
    },
    body,
  }).catch(() => {});
}
