import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { weekday } from "@/lib/format";
import type { Meeting } from "@/lib/types";
import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";

export const dynamic = "force-dynamic";

const grid = "1fr 150px 220px 90px";

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

        <div
          style={{
            background: "#fff",
            border: "1px solid #e4e8ef",
            borderRadius: 13,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(20,30,50,.04)",
          }}
        >
          <div
            className="mono"
            style={{
              display: "grid",
              gridTemplateColumns: grid,
              gap: 14,
              padding: "11px 20px",
              borderBottom: "1px solid #eceff4",
              background: "#fafbfd",
              fontSize: 11,
              color: "#9aa3b2",
              letterSpacing: ".03em",
              textTransform: "uppercase",
            }}
          >
            <div>제목 · 프로젝트</div>
            <div>날짜</div>
            <div>참여자</div>
            <div style={{ textAlign: "right" }}>관리</div>
          </div>

          {meetings.length === 0 ? (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                color: "#aab2c0",
                fontSize: 14,
              }}
            >
              아직 회의가 없습니다.{" "}
              <Link href="/meetings/new" style={{ color: "#3550c7" }}>
                새 회의를 시작
              </Link>
              해 보세요.
            </div>
          ) : (
            meetings.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: grid,
                  gap: 14,
                  padding: "15px 20px",
                  borderBottom: "1px solid #f1f3f7",
                  alignItems: "center",
                  color: "inherit",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/meetings/${m.id}`}
                    style={{
                      display: "block",
                      textDecoration: "none",
                      color: "inherit",
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: "#1b2231",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginBottom: 5,
                      }}
                    >
                      {m.title}
                    </div>
                  </Link>

                  <span
                    className="mono"
                    style={{
                      display: "inline-block",
                      background: "#eef1fc",
                      color: "#3a4890",
                      border: "1px solid #dde3f7",
                      borderRadius: 6,
                      padding: "2px 9px",
                      fontSize: 11.5,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.project_tag ?? "미분류"}
                  </span>
                </div>

                <Link
                  href={`/meetings/${m.id}`}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 13,
                      color: "#3a4252",
                      fontWeight: 500,
                    }}
                  >
                    {m.date}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "#aab2c0",
                      marginTop: 2,
                    }}
                  >
                    ({weekday(m.date)})
                  </div>
                </Link>

                <Link
                  href={`/meetings/${m.id}`}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "#6b7482",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {(m.participants ?? []).join(", ")}
                  </div>
                </Link>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <DeleteMeetingButton
                    meetingId={m.id}
                    meetingTitle={m.title}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "#aab2c0",
            marginTop: 14,
            textAlign: "right",
          }}
        >
          ↑ 검색이 안 될 땐 여기서 직접 훑어보세요
        </div>
      </div>
    </div>
  );
}