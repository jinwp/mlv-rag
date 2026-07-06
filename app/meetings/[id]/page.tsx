import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { weekday } from "@/lib/format";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import { PhotoUploadPanel } from "@/components/PhotoUploadPanel";
import { MeetingChatContextPanel } from "@/components/MeetingChatContextPanel";
import { MeetingSummaryPanel } from "@/components/MeetingSummaryPanel";
import { MeetingDetailWorkspace } from "@/components/MeetingDetailWorkspace";
import { MeetingWriteToNotionPanel } from "@/components/MeetingWriteToNotionPanel";

export const dynamic = "force-dynamic";

const NOTE_COLLAPSE_CHARS = 700;

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

const noteText: React.CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "#25303f",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const noteSummary: React.CSSProperties = {
  cursor: "pointer",
  listStyle: "none",
};

const noteToggle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 7,
  fontSize: 12,
  fontWeight: 700,
  color: "#3550c7",
};

function CollapsibleNote({ content }: { content: string }) {
  const text = content?.trim() ?? "";
  const shouldCollapse = text.length > NOTE_COLLAPSE_CHARS;

  if (!shouldCollapse) {
    return <span style={noteText}>{text}</span>;
  }

  const preview = `${text.slice(0, NOTE_COLLAPSE_CHARS).trimEnd()}\n...`;

  return (
    <details style={noteText}>
      <summary style={noteSummary}>
        <span style={noteText}>{preview}</span>
        <span style={noteToggle}>Show full note</span>
      </summary>

      <div
        style={{
          marginTop: 10,
          padding: 12,
          borderRadius: 10,
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </details>
  );
}

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

              
              <MeetingWriteToNotionPanel
                key="write-to-notion"
                meeting={meeting}
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