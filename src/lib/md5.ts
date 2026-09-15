/**
 * 纯 TypeScript MD5 实现（零依赖，Node / Edge Runtime 均可运行）
 * B 站 WBI 签名依赖 MD5，而 WebCrypto 不提供 MD5，因此自带一份。
 */

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const TABLE: number[] = (() => {
  const t = new Array<number>(64);
  for (let i = 0; i < 64; i++) {
    t[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }
  return t;
})();

/** MD5 → 32 位小写十六进制 */
export function md5(message: string | Uint8Array): string {
  const input = typeof message === "string" ? new TextEncoder().encode(message) : message;

  const bitLen = input.length * 8;
  const withPad = new Uint8Array(((input.length + 8) >> 6) * 64 + 64);
  withPad.set(input);
  withPad[input.length] = 0x80;

  const lo = bitLen >>> 0;
  const hi = Math.floor(bitLen / 0x100000000) >>> 0;
  const lenOffset = withPad.length - 8;
  new DataView(withPad.buffer).setUint32(lenOffset, lo, true);
  new DataView(withPad.buffer).setUint32(lenOffset + 4, hi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const view = new DataView(withPad.buffer);
  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    const m = new Int32Array(16);
    for (let j = 0; j < 16; j++) m[j] = view.getInt32(chunk + j * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + TABLE[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << SHIFT[i]) | (f >>> (32 - SHIFT[i])))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setInt32(0, a0, true);
  ov.setInt32(4, b0, true);
  ov.setInt32(8, c0, true);
  ov.setInt32(12, d0, true);

  let hex = "";
  for (let i = 0; i < 16; i++) hex += (out[i] & 0xff).toString(16).padStart(2, "0");
  return hex;
}
