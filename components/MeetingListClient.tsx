"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Meeting } from "@/lib/types";
import { weekday } from "@/lib/format";
import { DeleteMeetingButton } from "@/components/DeleteMeetingButton";

type Props = {
  meetings: Meeting[];
};

function parseFilterKeywords(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function meetingSearchBlob(meeting: Meeting): string {
  return [
    meeting.id,
    meeting.title ?? "",
    meeting.date ?? "",
    meeting.project_tag ?? "",
    meeting.agenda ?? "",
    ...(meeting.participants ?? []),
  ]
    .join("\n")
    .toLowerCase();
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d8dee9",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const cardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "center",
  padding: "15px 17px",
  background: "#fff",
  border: "1px solid #e4e8ef",
  borderRadius: 13,
  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
};

export function MeetingListClient({ meetings }: Props) {
  const [filterText, setFilterText] = useState("");

  const keywords = useMemo(
    () => parseFilterKeywords(filterText),
    [filterText]
  );

  const filteredMeetings = useMemo(() => {
    if (keywords.length === 0) return meetings;

    return meetings.filter((meeting) => {
      const blob = meetingSearchBlob(meeting);
      return keywords.some((keyword) => blob.includes(keyword));
    });
  }, [meetings, keywords]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gap: 7,
          padding: 14,
          border: "1px solid #e4e8ef",
          borderRadius: 13,
          background: "#fafbfd",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>
            회의 필터
          </div>

          <div className="mono" style={{ fontSize: 11, color: "#94a3b8" }}>
            showing {filteredMeetings.length} / {meetings.length}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="키워드로 회의 검색: gepa, image upload, 서진우, 2026-07-01 ..."
            style={inputStyle}
          />

          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              style={{
                border: "1px solid #cfd7e3",
                background: "#fff",
                borderRadius: 9,
                padding: "0 11px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {filteredMeetings.map((meeting) => (
        <div key={meeting.id} style={cardStyle}>
          <Link
            href={`/meetings/${meeting.id}`}
            style={{
              minWidth: 0,
              textDecoration: "none",
              color: "inherit",
              display: "grid",
              gap: 7,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "#1f2937",
                  wordBreak: "break-word",
                }}
              >
                {meeting.title}
              </span>

              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "#3a4890",
                  background: "#eef1fc",
                  border: "1px solid #dde3f7",
                  borderRadius: 6,
                  padding: "2px 7px",
                }}
              >
                {meeting.project_tag ?? "미분류"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 16px",
                fontSize: 12.5,
                color: "#64748b",
              }}
            >
              <span className="mono">
                📅 {meeting.date} ({weekday(meeting.date)})
              </span>
              <span>👥 {(meeting.participants ?? []).join(", ") || "참여자 없음"}</span>
            </div>

            {meeting.agenda && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "#64748b",
                  lineHeight: 1.45,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {meeting.agenda}
              </div>
            )}
          </Link>

          <DeleteMeetingButton meetingId={meeting.id} meetingTitle={meeting.title} />
        </div>
      ))}

      {filteredMeetings.length === 0 && (
        <div
          style={{
            padding: 24,
            border: "1px dashed #d5dce6",
            borderRadius: 13,
            textAlign: "center",
            color: "#94a3b8",
            background: "#fff",
            fontSize: 13,
          }}
        >
          검색 조건에 맞는 회의가 없습니다.
        </div>
      )}
    </div>
  );
}
