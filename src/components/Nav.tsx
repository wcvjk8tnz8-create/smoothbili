"use client";

/** 顶部导航：搜索 + 分区入口 + 登录态 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SearchBox from "./SearchBox";
import LoginModal from "./LoginModal";
import { img } from "@/lib/format";

const LINKS = [
  { href: "/", label: "首页" },
  { href: "/ranking", label: "排行榜" },
];

type User = { mid: string | number; uname: string; face: string; level?: number };

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/user/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setUser(j?.isLogin ? j.user : null))
      .catch(() => setUser(null));
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const logout = async () => {
    await fetch("/api/login/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
    setMenuOpen(false);
    router.refresh();
  };

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/" className="logo" prefetch={false}>
            <span className="logo-mark">滑</span>
            <span>SmoothBili</span>
          </Link>

          <div className="nav-links">
            {LINKS.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`nav-link${active ? " active" : ""}`}
                  prefetch={false}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>

          <SearchBox />

          <div style={{ position: "relative", marginLeft: "auto" }}>
            {user ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="avatar-btn"
                  src={img(user.face, ".webp")}
                  alt={user.uname}
                  onClick={() => setMenuOpen((v) => !v)}
                  style={{ cursor: "pointer" }}
                />
                {menuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 42,
                      minWidth: 150,
                      background: "var(--bg-elev)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      boxShadow: "0 8px 30px rgba(0,0,0,.15)",
                      overflow: "hidden",
                      zIndex: 80,
                    }}
                  >
                    <Link
                      href={`/space/${user.mid}`}
                      className="suggest-item"
                      style={{ display: "block" }}
                      prefetch={false}
                    >
                      我的空间
                    </Link>
                    <button
                      className="suggest-item"
                      style={{ width: "100%", textAlign: "left" }}
                      onClick={logout}
                    >
                      退出登录
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => setLoginOpen(true)}>
                登录
              </button>
            )}
          </div>
        </div>
      </nav>

      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={(u) => {
            setUser(u);
            setLoginOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
