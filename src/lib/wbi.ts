/**
 * B 站 WBI 签名（与 piliplus / bilibili-API-collect 的实现一致）
 *
 * 1. GET /x/web-interface/nav → data.wbi_img.img_url / sub_url，取文件名（去扩展名）得到 img_key / sub_key
 * 2. raw = img_key + sub_key，按 MIXIN_KEY_ENC_TAB 重排取前 32 位 → mixin_key
 * 3. 参数加 wts（秒级时间戳）→ 按键名升序 → 过滤 !'()* → 百分号编码 → 拼接
 * 4. md5(query + mixin_key) = w_rid
 *
 * 密钥全站统一、每日轮换，必须缓存 + 失败重试，不能硬编码。
 */

import { md5 } from "./md5";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33,
  9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17,
  0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44,
  52,
];

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

export function parseWbiKeys(imgUrl: string, subUrl: string): WbiKeys {
  const name = (u: string) => (u.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return { imgKey: name(imgUrl), subKey: name(subUrl) };
}

export function getMixinKey({ imgKey, subKey }: WbiKeys): string {
  const raw = imgKey + subKey;
  let out = "";
  for (let i = 0; i < 32; i++) out += raw[MIXIN_KEY_ENC_TAB[i]] ?? "";
  return out;
}

/** B 站要求过滤掉值里的 !'()* 再参与签名 */
function sanitize(value: string): string {
  return value.replace(/[!'()*]/g, "");
}

/** 与 encodeURIComponent 一致，但 ~!'() 需保留 B 站的特殊编码行为 */
function encodeComponent(str: string): string {
  return encodeURIComponent(str);
}

export type Params = Record<string, string | number | boolean | undefined | null>;

/** 给参数加 WBI 签名，返回 URLSearchParams */
export function signWbi(
  params: Params,
  keys: WbiKeys,
  wts: number = Math.floor(Date.now() / 1000),
): URLSearchParams {
  const mixinKey = getMixinKey(keys);

  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    entries.push([encodeComponent(k), encodeComponent(sanitize(String(v)))]);
  }
  entries.push(["wts", String(wts)]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const query = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const wRid = md5(query + mixinKey);

  const signed = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    signed.set(k, String(v));
  }
  signed.set("w_rid", wRid);
  signed.set("wts", String(wts));
  return signed;
}

/** 构造完整带签名的 URL */
export function buildWbiUrl(
  base: string,
  params: Params,
  keys: WbiKeys,
  wts?: number,
): string {
  const qs = signWbi(params, keys, wts).toString();
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}
