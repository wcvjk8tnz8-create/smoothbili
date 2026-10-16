/**
 * 登录态：把 B 站的 SESSDATA / bili_jct / DedeUserID 用 AES-GCM 加密后放进 httpOnly Cookie。
 *
 * 明文放浏览器风险太高，因此加密；服务端不落库，用户可一键登出。
 */

export const SESSION_COOKIE = "smoothbili_session";

/**
 * 设备指纹 Cookie。
 *
 * 为什么必须持久化到浏览器：
 * Cloudflare Workers / Serverless 是多实例的，内存全局变量在每个实例各有一份。
 * 如果 buvid3 只存在内存里，生成二维码和轮询扫码会落在不同实例、拿到不同的
 * buvid3，B 站判定设备指纹不一致 —— 表现为"登录成功但不下发 Cookie"。
 *
 * 放进 Cookie 后由浏览器携带，跨实例保持一致。buvid 本身不是敏感信息。
 */
export const GUEST_COOKIE = "smoothbili_guest";

interface GuestIdentityLike {
  buvid3: string;
  buvid4: string;
}

export function encodeGuestId(g: GuestIdentityLike): string {
  return b64encode(new TextEncoder().encode(JSON.stringify(g)).buffer as ArrayBuffer)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeGuestId(raw: string | undefined): GuestIdentityLike | null {
  if (!raw) return null;
  try {
    let s = raw.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const json = new TextDecoder().decode(b64decode(s));
    const o = JSON.parse(json) as GuestIdentityLike;
    if (!o?.buvid3) return null;
    return { buvid3: o.buvid3, buvid4: o.buvid4 ?? "" };
  } catch {
    return null;
  }
}

/** 生成设备指纹 Cookie（有效期 30 天） */
export function guestCookie(g: GuestIdentityLike): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GUEST_COOKIE}=${encodeGuestId(g)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`;
}

/** 从 SESSDATA 字符串解析出的凭据 */
export interface BiliCredential {
  DedeUserID: string;
  DedeUserID__ckMd5: string;
  SESSDATA: string;
  bili_jct: string;
  buvid3: string;
  refresh_token?: string;
  uname?: string;
  face?: string;
  isLogin: boolean;
  /** 过期时间戳（ms） */
  exp?: number;
}

export function getSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    "smoothbili-dev-secret-please-change-in-production"
  );
}

async function getAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function encodeCredential(cred: BiliCredential): Promise<string> {
  const key = await getAesKey(getSecret());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(cred));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const merged = new Uint8Array(iv.length + enc.byteLength);
  merged.set(iv, 0);
  merged.set(new Uint8Array(enc), iv.length);
  return b64encode(merged.buffer)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function decodeCredential(
  token: string | undefined,
): Promise<BiliCredential | null> {
  if (!token) return null;
  try {
    const merged = b64decode(
      token.replace(/-/g, "+").replace(/_/g, "/"),
    );
    const key = await getAesKey(getSecret());
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: merged.slice(0, 12) },
      key,
      merged.slice(12),
    );
    const cred = JSON.parse(new TextDecoder().decode(dec)) as BiliCredential;
    if (cred.exp && cred.exp < Date.now()) return null;
    return cred;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** 拼成 B 站需要的 Cookie 头 */
export function toCookieHeader(
  cred: BiliCredential | null,
  extra?: Record<string, string>,
): string {
  const parts: string[] = [];
  if (cred) {
    for (const k of [
      "DedeUserID",
      "DedeUserID__ckMd5",
      "SESSDATA",
      "bili_jct",
      "buvid3",
    ] as const) {
      const v = cred[k];
      if (v) parts.push(`${k}=${v}`);
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) if (v) parts.push(`${k}=${v}`);
  }
  return parts.join("; ");
}

/**
 * 从用户粘贴的 Cookie 文本里提取关键字段。
 * 支持整段粘贴 request 头里的 Cookie，容错处理空格 / 换行 / 引号。
 */
export function parseCookieText(text: string): Partial<BiliCredential> & {
  buvid3?: string;
} {
  const out: Record<string, string> = {};
  const normalized = text.replace(/\r?\n/g, "; ").replace(/"/g, "");
  for (const seg of normalized.split(";")) {
    const idx = seg.indexOf("=");
    if (idx <= 0) continue;
    const k = seg.slice(0, idx).trim();
    const v = seg.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return {
    DedeUserID: out.DedeUserID ?? "",
    DedeUserID__ckMd5: out.DedeUserID__ckMd5 ?? "",
    SESSDATA: out.SESSDATA ?? "",
    bili_jct: out.bili_jct ?? "",
    buvid3: out.buvid3 ?? "",
  };
}
