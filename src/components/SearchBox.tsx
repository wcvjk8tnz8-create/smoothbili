"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [suggests, setSuggests] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const fetchSuggest = (term: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!term.trim()) {
      setSuggests([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/suggest?term=${encodeURIComponent(term)}`,
          { credentials: "same-origin" },
        );
        const json = await res.json();
        setSuggests(Array.isArray(json?.data) ? json.data.slice(0, 8) : []);
        setOpen(true);
      } catch {
        setSuggests([]);
      }
    }, 220);
  };

  const submit = (term: string) => {
    const value = term.trim();
    if (!value) return;
    setOpen(false);
    router.push(`/search?keyword=${encodeURIComponent(value)}`);
  };

  return (
    <div className="searchbox" ref={boxRef}>
      <div className="searchbox-row">
        <span style={{ color: "var(--text-faint)", fontSize: 14 }}>🔍</span>
        <input
          value={q}
          placeholder="搜索视频 / UP 主"
          onChange={(e) => {
            setQ(e.target.value);
            fetchSuggest(e.target.value);
          }}
          onFocus={() => suggests.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((v) => Math.min(v + 1, suggests.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((v) => Math.max(v - 1, -1));
            } else if (e.key === "Enter") {
              submit(active >= 0 && suggests[active] ? suggests[active] : q);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setSuggests([]);
            }}
            style={{ color: "var(--text-faint)", fontSize: 13 }}
          >
            ✕
          </button>
        )}
      </div>

      {open && suggests.length > 0 && (
        <div className="search-suggest">
          {suggests.map((s, i) => (
            <div
              key={s}
              className={`suggest-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => submit(s)}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
