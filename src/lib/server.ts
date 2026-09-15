import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  decodeCredential,
  type BiliCredential,
} from "./session";

/** 在 RSC / Route Handler 中读取当前登录态 */
export async function getCredential(): Promise<BiliCredential | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return await decodeCredential(token);
  } catch {
    return null;
  }
}
