"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type NavKey = "new" | "list" | "ask";

const NAV: { key: NavKey; label: string; sub: string; href: string }[] = [
  { key: "new", label: "새 회의", sub: "/meetings/new", href: "/meetings/new" },
  { key: "list", label: "회의 목록", sub: "/meetings", href: "/meetings" },
  { key: "ask", label: "검색 · 챗봇", sub: "/ask", href: "/ask" },
];

function groupFor(pathname: string): NavKey {
  if (pathname.startsWith("/meetings/new")) return "new";
  if (pathname.startsWith("/meetings")) {
    // record screen belongs to the "new" flow, list/detail to "list"
    if (pathname.endsWith("/record")) return "new";
    return "list";
  }
  return "ask";
}

// Matches /meetings/<id> or /meetings/<id>/record, capturing the id — but not
// /meetings/new (handled by the earlier branch in groupFor/display logic).
const MEETING_ROUTE = /^\/meetings\/([^/]+)(\/record)?$/;

/** Header shows the meeting title instead of the raw UUID for readability. */
function displayPath(pathname: string, titleById: Record<string, string>): string {
  const m = pathname.match(MEETING_ROUTE);
  if (!m || m[1] === "new") return pathname;
  const [, id, recordSuffix] = m;
  const title = titleById[id];
  if (!title) return pathname;
  return `/meetings/${title}${recordSuffix ?? ""}`;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/ask";
  const group = groupFor(pathname);
  const [count, setCount] = useState<number | null>(null);
  const [titleById, setTitleById] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => {
        if (alive) setCount(count ?? 0);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    const m = pathname.match(MEETING_ROUTE);
    if (!m || m[1] === "new" || titleById[m[1]]) return;
    const id = m[1];
    let alive = true;
    supabase
      .from("meetings")
      .select("title")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (alive && data?.title) setTitleById((prev) => ({ ...prev, [id]: data.title }));
      });
    return () => {
      alive = false;
    };
  }, [pathname, titleById]);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", overflow: "hidden" }}>
      {/* ============ SIDEBAR ============ */}
      <aside
        style={{
          width: 246,
          flex: "none",
          background: "#e7ebf1",
          borderRight: "1px solid #d9dfe8",
          display: "flex",
          flexDirection: "column",
          padding: "20px 14px 14px",
        }}
      >
        <Link
          href="/ask"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "2px 8px 20px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              flex: "none",
              borderRadius: 8,
              background: "#1b2231",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ›
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-.01em", lineHeight: 1.1 }}>
              Lab <span style={{ color: "#3550c7" }}>RAG</span>
            </div>
            <div
              className="mono"
              style={{ fontSize: 10, color: "#8a93a3", marginTop: 2, letterSpacing: ".02em" }}
            >
              KAIST CS · 생성AI/로보틱스
            </div>
          </div>
        </Link>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => {
            const active = group === n.key;
            return (
              <Link
                key={n.key}
                href={n.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 9,
                  padding: "9px 11px",
                  textDecoration: "none",
                  transition: "background .12s",
                  ...(active
                    ? {
                        background: "#fff",
                        color: "#1b2231",
                        boxShadow: "inset 2px 0 0 #3550c7, 0 1px 2px rgba(20,30,50,.05)",
                      }
                    : { color: "#68717f" }),
                }}
              >
                <span
                  style={{
                    flex: "none",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: active ? "#3550c7" : "#c2cad6",
                  }}
                />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 1,
                    lineHeight: 1.15,
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{n.label}</span>
                  <span className="mono" style={{ fontSize: 10, opacity: 0.62 }}>
                    {n.sub}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          style={{
            marginTop: "auto",
            padding: "12px 10px 4px",
            borderTop: "1px solid #d9dfe8",
          }}
        >
          <div className="mono" style={{ fontSize: 10.5, color: "#8a93a3", lineHeight: 1.7 }}>
            <div>
              <span style={{ color: "#2fa36b" }}>●</span> main · synced
            </div>
            <div>{count ?? "—"} meetings indexed</div>
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "#f4f6f9",
        }}
      >
        <header
          style={{
            flex: "none",
            height: 44,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 22px",
            borderBottom: "1px solid #e4e8ef",
            background: "#f4f6f9",
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: "#9aa3b2" }}>
            labrag
          </span>
          <span className="mono" style={{ fontSize: 12, color: "#c2cad6" }}>
            :~$
          </span>
          <span
            className="mono"
            style={{
              fontSize: 12.5,
              color: "#5b6472",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayPath(pathname, titleById)}
          </span>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
