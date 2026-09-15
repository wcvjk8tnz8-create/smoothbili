/** 全站捐助信息：改这里就能换收款码 */

export const SPONSOR = {
  alipayhk: {
    label: "AlipayHK 支付宝香港",
    qr: "/sponsor/alipayhk.jpg",
    hint: "打开 AlipayHK App 扫描二维码付款（HKD）",
  },
  note: "本项目永久免费、无广告、不盈利。赞助仅用于覆盖域名与服务器成本。",
  costs: [
    { item: "域名（.com 续费）", amount: "约 ¥90 / 年" },
    { item: "服务器 / CDN（基础额度）", amount: "约 ¥0 - 300 / 年" },
    { item: "开发与维护", amount: "用爱发电" },
  ],
} as const;
