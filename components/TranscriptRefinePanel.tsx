"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Transcript } from "@/lib/types";

type Props = {
  meeting: Meeting;
  notes: Note[];
  transcripts: Transcript[];
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
  borderColor: "#111827",
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
  borderColor: "#bbf7d0",
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

export function TranscriptRefinePanel({
  meeting,
  notes,
  transcripts,
}: Props) {
  const [items, setItems] = useState<Transcript[]>(transcripts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakerMaps, setSpeakerMaps] = useState<Record<string, string>>({});

  async function refineTranscript(t: Transcript) {
    setBusyId(t.id);
    setError(null);

    const speakerMapText = speakerMaps[t.id] ?? "";
    const refinedAt = new Date().toISOString();

    try {
      const res = await fetch("/api/refine-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawText: t.full_text,
          speakerMapText,
          meeting: {
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Refinement failed");
      }

      const refinedText = data.refinedText as string;
      const contextSummary = data.contextSummary as string;

      const { error: updateError } = await supabase
        .from("transcripts")
        .update({
          refined_text: refinedText,
          refinement_context: contextSummary,
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
                refinement_context: contextSummary,
                refined_at: refinedAt,
              }
            : item
        )
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
            raw transcript → speaker-aware notes-context rewrite
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

        {items.length === 0 ? (
          <p style={{ margin: 0, color: "#64748b" }}>전사 기록이 없습니다.</p>
        ) : (
          items.map((t) => (
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
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>

                <button
                  style={{
                    ...primaryButton,
                    opacity: busyId === t.id ? 0.65 : 1,
                    cursor: busyId === t.id ? "not-allowed" : "pointer",
                  }}
                  disabled={busyId === t.id}
                  onClick={() => refineTranscript(t)}
                >
                  {busyId === t.id ? "Rewriting..." : "Rewrite with notes"}
                </button>
              </div>

              {t.audio_path && (
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  audio: {t.audio_path}
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
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  입력한 speaker mapping은 rewrite 때 A/B/C 라벨을 실제 이름으로 치환하는 데 사용됩니다.
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
                      refined at {new Date(t.refined_at).toLocaleString()}
                    </div>
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
                  Speaker mapping을 입력한 뒤 Rewrite with notes를 실행하면 refined transcript가 생성됩니다.
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}