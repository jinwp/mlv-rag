"use client";

import { useState } from "react";
import type { Note } from "@/lib/types";

type Props = {
  meetingId: string;
  notes: Note[];
  onNotesChange: (notes: Note[]) => void;
};

type CreateNoteResponse = {
  ok?: boolean;
  note?: Note;
  error?: string;
  details?: unknown;
};

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

const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d9dee8",
  borderRadius: 9,
  padding: "8px 10px",
  fontSize: 12.5,
  outline: "none",
  background: "#fff",
};

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 86,
  resize: "vertical",
  lineHeight: 1.5,
};

const button: React.CSSProperties = {
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  borderRadius: 8,
  padding: "7px 10px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 12.5,
};

function detailsText(details: unknown) {
  if (!details) return "";

  if (typeof details === "string") return details;

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function fmtElapsed(seconds?: number | null) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
}

function parseElapsedInput(value: string): number | null {
  const text = value.trim();

  if (!text) return null;

  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(":").map((part) => part.trim());

  if (parts.length === 2) {
    const [m, s] = parts.map(Number);

    if (Number.isFinite(m) && Number.isFinite(s)) {
      return m * 60 + s;
    }
  }

  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);

    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      return h * 3600 + m * 60 + s;
    }
  }

  throw new Error("Elapsed time must be seconds, mm:ss, or hh:mm:ss.");
}

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

export function MeetingNotesPanel({
  meetingId,
  notes,
  onNotesChange,
}: Props) {
  const [content, setContent] = useState("");
  const [elapsedInput, setElapsedInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);

  async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textareaEl = document.createElement("textarea");
    textareaEl.value = text;
    textareaEl.style.position = "fixed";
    textareaEl.style.left = "-9999px";
    textareaEl.style.top = "-9999px";
    document.body.appendChild(textareaEl);
    textareaEl.focus();
    textareaEl.select();
    document.execCommand("copy");
    document.body.removeChild(textareaEl);
  }

  async function copyNote(note: Note) {
    const noteId = String(note.id);
    const text = `[${fmtElapsed(note.elapsed_seconds)}] ${note.content?.trim() ?? ""}`;

    try {
      await copyTextToClipboard(text);
      setCopiedNoteId(noteId);

      window.setTimeout(() => {
        setCopiedNoteId((current) => (current === noteId ? null : current));
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy note.");
    }
  }

  async function addNote() {
    setBusy(true);
    setError("");

    try {
      const elapsedSeconds = parseElapsedInput(elapsedInput);

      const res = await fetch("/api/meeting-notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId,
          content,
          elapsedSeconds,
        }),
      });

      const data = (await res.json()) as CreateNoteResponse;

      if (!res.ok || data.error || !data.note) {
        throw new Error(
          [data.error ?? "failed to create note", detailsText(data.details)]
            .filter(Boolean)
            .join(": ")
        );
      }

      onNotesChange([...notes, data.note]);
      setContent("");
      setElapsedInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note.");
    } finally {
      setBusy(false);
    }
  }

  const canAdd = content.trim().length > 0 && !busy;

  return (
    <section style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#3a4252" }}>
            자체 메모
          </div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            저장 후 추가한 메모도 rewrite context로 사용
          </div>
        </div>

        <span className="mono" style={{ fontSize: 10.5, color: "#aab2c0" }}>
          NOTES
        </span>
      </div>

      <div style={{ padding: 14, borderBottom: "1px solid #eef2f7" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="추가 context 메모를 입력하세요. 다음 Rewrite with notes 실행 시 바로 반영됩니다."
            style={textarea}
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              value={elapsedInput}
              onChange={(e) => setElapsedInput(e.target.value)}
              placeholder="optional time: 90, 01:30, 00:01:30"
              style={input}
            />

            <button
              type="button"
              onClick={addNote}
              disabled={!canAdd}
              style={{
                ...button,
                opacity: canAdd ? 1 : 0.55,
                cursor: canAdd ? "pointer" : "not-allowed",
              }}
            >
              {busy ? "Adding..." : "Add note"}
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: 10,
                borderRadius: 9,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          padding: "8px 6px",
          maxHeight: 520,
          overflow: "auto",
        }}
      >
        {notes.map((note, index) => {
          const noteId = String(note.id);
          const copied = copiedNoteId === noteId;

          return (
            <div
              key={`${note.id}-${index}`}
              role="button"
              tabIndex={0}
              title="Click to copy this note"
              onClick={() => copyNote(note)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  copyNote(note);
                }
              }}
              style={{
                display: "flex",
                gap: 11,
                padding: "9px 12px",
                borderRadius: 8,
                cursor: "pointer",
                background: copied ? "#ecfdf5" : "transparent",
                border: copied ? "1px solid #bbf7d0" : "1px solid transparent",
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
                [{fmtElapsed(note.elapsed_seconds)}]
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                {copied && (
                  <div
                    style={{
                      display: "inline-block",
                      marginBottom: 5,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: "#dcfce7",
                      color: "#166534",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    Copied
                  </div>
                )}

                <CollapsibleNote content={note.content} />
              </div>
            </div>
          );
        })}

        {notes.length === 0 && (
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
    </section>
  );
}