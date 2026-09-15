import Link from "next/link";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
            SmoothBili · 哔哩滑滑 Biliboli
          </div>
          <div>无广告 · 不追踪 · 非盈利 · 数据直连 B 站官方接口</div>
        </div>

        <div className="footer-links">
          <Link href="/sponsor" prefetch={false}>
            ♥ 赞助开发者
          </Link>
          <a href="https://www.bilibili.com/" target="_blank" rel="noreferrer noopener">
            B 站官网
          </a>
          <Link href="/ranking" prefetch={false}>
            排行榜
          </Link>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
          本站为个人学习项目，与哔哩哔哩官方无关。视频版权归原作者所有。
        </div>
      </div>
    </footer>
  );
}
