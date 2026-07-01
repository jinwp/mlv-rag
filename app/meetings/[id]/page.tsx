import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { weekday } from "@/lib/format";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import { TranscriptRefinePanel } from "@/components/TranscriptRefinePanel";
import { PhotoUploadPanel } from "@/components/PhotoUploadPanel";
import { MeetingChatContextPanel } from "@/components/MeetingChatContextPanel";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e8ef",
  borderRadius: 13,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
};

const cardHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "13px 18px",
  borderBottom: "1px solid #eceff4",
  background: "#fafbfd",
};

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single<Meeting>();

  if (!meeting) notFound();

  const [{ data: transcripts }, { data: photos }, { data: notes }] =
    await Promise.all([
      supabase
        .from("transcripts")
        .select("*")
        .eq("meeting_id", id)
        .order("created_at", { ascending: true })
        .returns<Transcript[]>(),
      supabase
        .from("photos")
        .select("*")
        .eq("meeting_id", id)
        .order("elapsed_seconds", { ascending: true })
        .returns<Photo[]>(),
      supabase
        .from("notes")
        .select("*")
        .eq("meeting_id", id)
        .order("elapsed_seconds", { ascending: true })
        .returns<Note[]>(),
    ]);

  const transcript = transcripts ?? [];
  const photoList = photos ?? [];
  const noteList = notes ?? [];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: "34px 30px 80px",
      }}
    >
      <div style={{ maxWidth: 1020, margin: "0 auto" }}>
        <Link
          href="/meetings"
          className="mono"
          style={{
            display: "inline-block",
            color: "#8a93a3",
            fontSize: 12,
            textDecoration: "none",
            marginBottom: 14,
          }}
        >
          ← 회의 목록
        </Link>

        <div style={{ marginBottom: 22 }}>
          <span
            className="mono"
            style={{
              display: "inline-block",
              background: "#eef1fc",
              color: "#3a4890",
              border: "1px solid #dde3f7",
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 11,
              whiteSpace: "nowrap",
            }}
          >
            {meeting.project_tag ?? "미분류"}
          </span>

          <h1
            style={{
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: "-.02em",
              margin: "0 0 12px",
              lineHeight: 1.25,
            }}
          >
            {meeting.title}
          </h1>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 22px",
              fontSize: 13,
              color: "#6b7482",
            }}
          >
            <span className="mono" style={{ color: "#3a4252" }}>
              📅 {meeting.date} ({weekday(meeting.date)})
            </span>
            <span>👥 {(meeting.participants ?? []).join(", ")}</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* transcript */}
          <div
            style={{
              flex: "1 1 520px",
              minWidth: 320,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <TranscriptRefinePanel
              meeting={meeting}
              notes={noteList}
              transcripts={transcript}
            />
            <MeetingChatContextPanel meetingId={meeting.id} />
          </div>

          {/* right rail */}
          <div
            style={{
              flex: "1 1 300px",
              minWidth: 280,
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <PhotoUploadPanel
              meeting={meeting}
              initialPhotos={photoList}
              transcripts={transcript}
              notes={noteList}
            />

            {/* notes */}
            <div style={card}>
              <div style={cardHead}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#3a4252",
                  }}
                >
                  자체 메모
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "#aab2c0" }}
                >
                  NOTES
                </span>
              </div>

              <div style={{ padding: "8px 6px" }}>
                {noteList.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      gap: 11,
                      padding: "9px 12px",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        flex: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#3550c7",
                        paddingTop: 2,
                      }}
                    >
                      [{n.elapsed_seconds}]
                    </span>

                    <span
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: "#25303f",
                      }}
                    >
                      {n.content}
                    </span>
                  </div>
                ))}

                {noteList.length === 0 && (
                  <div
                    style={{
                      padding: 16,
                      textAlign: "center",
                      color: "#aab2c0",
                      fontSize: 12.5,
                    }}
                  >
                    메모 없음
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
