import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { weekday } from "@/lib/format";
import { meetingModeLabel } from "@/lib/meetings/modes";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import { PhotoUploadPanel } from "@/components/PhotoUploadPanel";
import { MeetingChatContextPanel } from "@/components/MeetingChatContextPanel";
import { MeetingSummaryPanel } from "@/components/MeetingSummaryPanel";
import { MeetingDetailWorkspace } from "@/components/MeetingDetailWorkspace";
import { MeetingWriteToNotionPanel } from "@/components/MeetingWriteToNotionPanel";

export const dynamic = "force-dynamic";

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
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
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
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginBottom: 11,
            }}
          >
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
                whiteSpace: "nowrap",
              }}
            >
              {meeting.project_tag ?? "미분류"}
            </span>

            <span
              className="mono"
              style={{
                display: "inline-block",
                background: "#f8fafc",
                color: "#334155",
                border: "1px solid #dbe3ef",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {meetingModeLabel(meeting.mode)}
            </span>
          </div>

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

        <div style={{ marginBottom: 20 }}>
          <MeetingWriteToNotionPanel meeting={meeting} />
        </div>

        <MeetingDetailWorkspace
          meeting={meeting}
          notes={noteList}
          transcripts={transcript}
          summaryPanel={
            <MeetingSummaryPanel
              meetingId={meeting.id}
              initialSummary={meeting.summary_text ?? ""}
              initialProvider={
                meeting.summary_model ? `openai:${meeting.summary_model}` : ""
              }
              initialGeneratedAt={meeting.summary_generated_at ?? ""}
            />
          }
          rightRailChildren={
            <>
              <MeetingChatContextPanel
                key="meeting-chat-context"
                meetingId={meeting.id}
              />
            </>
          }
          photoPanel={
            <PhotoUploadPanel
              meeting={meeting}
              initialPhotos={photoList}
              transcripts={transcript}
              notes={noteList}
            />
          }
        />
      </div>
    </div>
  );
}