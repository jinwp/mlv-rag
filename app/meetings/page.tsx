import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { Meeting } from "@/lib/types";
import { MeetingListClient } from "@/components/MeetingListClient";

export const dynamic = "force-dynamic";

export default async function MeetingsListPage() {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<Meeting[]>();

  const meetings = data ?? [];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: "40px 30px 80px",
      }}
    >
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "#8a93a3",
                letterSpacing: ".04em",
                marginBottom: 6,
              }}
            >
              ALL SESSIONS
            </div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-.02em",
                margin: 0,
              }}
            >
              회의 목록
            </h1>
          </div>

          <Link
            href="/meetings/new"
            style={{
              border: "1px solid #d8dee7",
              background: "#fff",
              color: "#3550c7",
              borderRadius: 9,
              padding: "9px 15px",
              fontSize: 13.5,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            + 새 회의
          </Link>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              fontSize: 13,
              color: "#c0323a",
              background: "#fdecec",
              border: "1px solid #f3caca",
              borderRadius: 9,
              padding: "10px 14px",
            }}
          >
            회의를 불러오지 못했습니다: {error.message}
          </div>
        )}

        <MeetingListClient meetings={meetings} />

        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "#aab2c0",
            marginTop: 14,
            textAlign: "right",
          }}
        >
          ↑ 키워드 검색이 애매하면 필터를 비우고 직접 훑어보세요
        </div>
      </div>
    </div>
  );
}