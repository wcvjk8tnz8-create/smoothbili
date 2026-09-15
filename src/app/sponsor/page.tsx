import Link from "next/link";
import { SPONSOR } from "@/lib/sponsor";

export const metadata = {
  title: "赞助 SmoothBili",
  description:
    "SmoothBili 是永久免费、无广告的非盈利项目，赞助仅用于覆盖域名与服务器成本。",
};

/** 感谢名单：手动维护，金额按赞助者意愿公开 */
const SUPPORTERS: Array<{ name: string; amount?: string; date: string }> = [
  // { name: "匿名", amount: "HK$50", date: "2026-09" },
];

export default function SponsorPage() {
  return (
    <div className="container">
      <div className="sponsor-card">
        <div>
          <h1 className="section-title" style={{ fontSize: 26, marginTop: 24 }}>
            赞助 SmoothBili
          </h1>

          <p style={{ color: "var(--text-dim)", fontSize: 14.5, lineHeight: 1.9 }}>
            SmoothBili（哔哩滑滑 Biliboli）是一个
            <strong>永久免费、无广告、不追踪、非盈利</strong>
            的第三方 B 站 Web 客户端。它由个人在业余时间开发维护，接口策略参考社区开源项目
            （piliplus / bilibili-API-collect 系），数据全部直连 B 站官方公开接口，
            不留存任何用户数据。
          </p>

          <div className="banner">
            赞助不是购买功能，也不会解锁任何特权 —— 站点所有功能对所有人永久开放。
            你的支持只会用于支付域名续费与服务器开销。
          </div>

          <h2 className="section-title" style={{ fontSize: 18, marginTop: 26 }}>
            成本明细
          </h2>
          <table className="cost-table">
            <tbody>
              {SPONSOR.costs.map((c) => (
                <tr key={c.item}>
                  <td>{c.item}</td>
                  <td>{c.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="section-title" style={{ fontSize: 18, marginTop: 26 }}>
            其他支持方式
          </h2>
          <ul
            style={{
              color: "var(--text-dim)",
              fontSize: 14,
              lineHeight: 2,
              paddingLeft: 20,
            }}
          >
            <li>在 GitHub 上给项目点个 Star</li>
            <li>提交 Issue 反馈 Bug 或提出功能建议</li>
            <li>提交 Pull Request 参与开发</li>
            <li>把站点分享给同样讨厌广告的朋友</li>
          </ul>

          <h2 className="section-title" style={{ fontSize: 18, marginTop: 26 }}>
            感谢名单
          </h2>
          {SUPPORTERS.length === 0 ? (
            <div className="empty" style={{ padding: "24px 0", textAlign: "left" }}>
              还没有人赞助 —— 也许你就是第一位 🥰
            </div>
          ) : (
            <div className="chips" style={{ flexWrap: "wrap" }}>
              {SUPPORTERS.map((s) => (
                <span key={s.name} className="chip">
                  {s.name}
                  {s.amount ? ` · ${s.amount}` : ""} · {s.date}
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 26 }}>
            <Link href="/" className="btn" prefetch={false}>
              ← 回到首页
            </Link>
          </div>
        </div>

        <aside>
          <div className="qr-panel">
            <div style={{ fontWeight: 700, fontSize: 15 }}>{SPONSOR.alipayhk.label}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SPONSOR.alipayhk.qr} alt="AlipayHK 收款码" />
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
              {SPONSOR.alipayhk.hint}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text-faint)",
                lineHeight: 1.7,
                textAlign: "center",
              }}
            >
              扫码后请自行填写金额。
              <br />
              如需在感谢名单中署名，备注里留下昵称即可。
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
