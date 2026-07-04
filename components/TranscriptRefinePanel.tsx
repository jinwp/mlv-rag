"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Transcript } from "@/lib/types";
import type { NotionSlideListItem } from "@/components/NotionSlideContextPicker";

type Props = {
  meeting: Meeting;
  notes: Note[];
  transcripts: Transcript[];
  selectedNotionSlides?: NotionSlideListItem[];
};

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

const button: React.CSSProperties = {
  border: "1px solid #cfd7e3",
  background: "#fff",
  borderRadius: 8,
  padding: "7px 11px",
  cursor: "pointer",
  fontWeight: 700,
};

const primaryButton: React.CSSProperties = {
  ...button,
  background: "#111827",
  color: "#fff",
  border: "1px solid #111827",
};

const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  margin: 0,
  padding: 14,
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  fontSize: 13,
  lineHeight: 1.6,
};

const rawDetails: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#f8fafc",
  padding: "10px 12px",
};

const rawSummary: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 800,
  color: "#3550c7",
};

const refinedScrollBox: React.CSSProperties = {
  ...pre,
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  maxHeight: 640,
  overflow: "auto",
};

const inputLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#303949",
  marginBottom: 6,
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 82,
  resize: "vertical",
  border: "1px solid #d8dee7",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13,
  lineHeight: 1.5,
  color: "#1b2231",
  outline: "none",
  background: "#fbfcfe",
};

const contextNotice: React.CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "#f6f8ff",
  border: "1px solid #dbe3ff",
  color: "#334155",
  fontSize: 12.5,
  lineHeight: 1.5,
};

function serializeRefinementContext(args: {
  contextSummary: string;
  refinementContext: unknown;
}) {
  if (args.refinementContext) {
    if (typeof args.refinementContext === "string") {
      return args.refinementContext;
    }

    return JSON.stringify(args.refinementContext, null, 2);
  }

  return args.contextSummary;
}

function formatDateTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

  return `${parts} KST`;
}

export function TranscriptRefinePanel({
  meeting,
  notes,
  transcripts,
  selectedNotionSlides = [],
}: Props) {
  const [items, setItems] = useState<Transcript[]>(transcripts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [speakerMaps, setSpeakerMaps] = useState<Record<string, string>>({});

  async function refineTranscript(t: Transcript) {
    const rawText = typeof t.full_text === "string" ? t.full_text : "";
    const hasRawText = rawText.trim().length > 0;
    const hasSlideContext = selectedNotionSlides.length > 0;

    if (!hasRawText && !hasSlideContext) {
      setError(
        "전사 텍스트가 없고 선택된 slide context도 없습니다. 먼저 전사를 생성하거나 slide context를 선택하세요."
      );
      return;
    }

    setBusyId(t.id);
    setError(null);
    setStatus(null);

    const speakerMapText = speakerMaps[t.id] ?? "";
    const refinedAt = new Date().toISOString();

    try {
      const notionSlidePageIds = selectedNotionSlides.map(
        (slide) => slide.pageId
      );

      const notionSlidePathMap = Object.fromEntries(
        selectedNotionSlides.map((slide) => [slide.pageId, slide.path])
      );

      const res = await fetch("/api/refine-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId: meeting.id,
          rawText,
          speakerMapText,
          meeting: {
            id: meeting.id,
            title: meeting.title,
            date: meeting.date,
            project_tag: meeting.project_tag,
            agenda: meeting.agenda,
            participants: meeting.participants,
          },
          notes: notes.map((n) => ({
            elapsed_seconds: n.elapsed_seconds,
            content: n.content,
          })),
          notionSlidePageIds,
          notionSlidePathMap,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Refinement failed");
      }

      if (data.mode === "chunk_only") {
        const insertedChunks =
          data.slideChunkSync?.insertedChunks ?? "unknown";

        setStatus(
          `Slide context synced to meeting RAG chunks. Inserted chunks: ${insertedChunks}.`
        );
        return;
      }

      const refinedText = data.refinedText as string;
      const contextSummary = data.contextSummary as string;
      const refinementContext = serializeRefinementContext({
        contextSummary,
        refinementContext: data.refinementContext,
      });

      const { error: updateError } = await supabase
        .from("transcripts")
        .update({
          refined_text: refinedText,
          refinement_context: refinementContext,
          refined_at: refinedAt,
        })
        .eq("id", t.id);

      if (updateError) {
        throw updateError;
      }

      setItems((prev) =>
        prev.map((item) =>
          item.id === t.id
            ? {
                ...item,
                refined_text: refinedText,
                refinement_context: refinementContext,
                refined_at: refinedAt,
              }
            : item
        )
      );

      const insertedChunks = data.slideChunkSync?.insertedChunks ?? 0;

      setStatus(
        insertedChunks > 0
          ? `Transcript rewritten. Slide chunks synced: ${insertedChunks}.`
          : "Transcript rewritten."
      );
    } catch (err: any) {
      console.error("[TranscriptRefinePanel] failed", err);
      setError(err?.message ?? "Transcript refinement failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontWeight: 800 }}>전사 (STT)</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            raw transcript → speaker-aware notes/slide-context rewrite + RAG
            sync
          </div>
        </div>
      </div>

      <div style={{ padding: 18, display: "grid", gap: 18 }}>
        {error && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {status && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#f0fdf4",
              color: "#166534",
              border: "1px solid #bbf7d0",
              fontSize: 13,
            }}
          >
            {status}
          </div>
        )}

        {selectedNotionSlides.length > 0 && (
          <div style={contextNotice}>
            Using {selectedNotionSlides.length} selected Notion slide context
            page{selectedNotionSlides.length > 1 ? "s" : ""}. The server reads
            them directly from Notion at execution time and syncs them into
            meeting RAG chunks.
          </div>
        )}

        {items.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b" }}>전사 기록이 없습니다.</p>
        ) : (
          items.map((t) => {
            const hasRawText =
              typeof t.full_text === "string" &&
              t.full_text.trim().length > 0;

            const hasSlideContext = selectedNotionSlides.length > 0;
            const canRun = hasRawText || hasSlideContext;

            return (
              <div
                key={t.id}
                style={{
                  display: "grid",
                  gap: 14,
                  border: "1px solid #eef2f7",
                  borderRadius: 12,
                  padding: 14,
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
                  <div>
                    <div style={{ fontWeight: 800 }}>
                      Transcript refinement
                    </div>

                    <div style={{ color: "#64748b", fontSize: 12 }}>
                      {formatDateTime(t.created_at)}
                    </div>
                  </div>

                  <button
                    style={{
                      ...primaryButton,
                      opacity: busyId === t.id || !canRun ? 0.65 : 1,
                      cursor:
                        busyId === t.id || !canRun
                          ? "not-allowed"
                          : "pointer",
                    }}
                    disabled={busyId === t.id || !canRun}
                    onClick={() => refineTranscript(t)}
                  >
                    {busyId === t.id
                      ? "Running..."
                      : hasRawText && hasSlideContext
                      ? "Rewrite with notes + slides"
                      : hasRawText
                      ? "Rewrite with notes"
                      : hasSlideContext
                      ? "Sync slides to RAG"
                      : "No transcript text"}
                  </button>
                </div>

                {t.audio_path && (
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    audio: {t.audio_path}
                  </div>
                )}

                {!hasRawText && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "#fff7ed",
                      border: "1px solid #fed7aa",
                      color: "#9a3412",
                      fontSize: 12.5,
                    }}
                  >
                    이 transcript row는 비어 있습니다. 선택된 slide context가
                    있으면 rewrite 없이 meeting RAG chunk만 업데이트합니다.
                  </div>
                )}

                <div>
                  <div style={inputLabel}>Speaker mapping</div>
                  <textarea
                    value={speakerMaps[t.id] ?? ""}
                    onChange={(e) =>
                      setSpeakerMaps((prev) => ({
                        ...prev,
                        [t.id]: e.target.value,
                      }))
                    }
                    placeholder={`예:\nA = 김현우 교수님\nB = 서진우\nC = 진승완 박사님`}
                    style={textarea}
                  />

                  <div
                    style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}
                  >
                    입력한 speaker mapping은 rewrite 때 A/B/C 라벨을 실제
                    이름으로 치환하는 데 사용됩니다.
                  </div>
                </div>

                <details style={rawDetails}>
                  <summary style={rawSummary}>Show raw transcript</summary>

                  <div style={{ marginTop: 10 }}>
                    <pre style={pre}>{t.full_text}</pre>
                  </div>
                </details>

                {t.refined_text ? (
                  <>
                    <div style={{ fontWeight: 800, marginTop: 2 }}>
                      Refined transcript
                    </div>

                    <pre style={refinedScrollBox}>{t.refined_text}</pre>

                    {t.refined_at && (
                      <div style={{ color: "#64748b", fontSize: 12 }}>
                        refined at {formatDateTime(t.refined_at)}
                      </div>
                    )}

                    {t.refinement_context && (
                      <details style={rawDetails}>
                        <summary style={rawSummary}>
                          Show rewrite metadata
                        </summary>

                        <div style={{ marginTop: 10 }}>
                          <pre style={pre}>{t.refinement_context}</pre>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: "1px dashed #d5dce6",
                      color: "#94a3b8",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  >
                    {hasRawText
                      ? "Speaker mapping을 입력한 뒤 Rewrite with notes를 실행하면 refined transcript가 생성됩니다."
                      : hasSlideContext
                      ? "전사 텍스트가 없으므로 실행 시 slide context만 meeting RAG chunks에 동기화됩니다."
                      : "전사 텍스트가 없습니다. 전사를 생성하거나 slide context를 선택하세요."}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}