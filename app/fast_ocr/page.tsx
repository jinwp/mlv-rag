"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { Meeting } from "@/lib/types";

type LoadState = "idle" | "loading" | "done" | "error";
type WorkMode = "text" | "latex" | "figure";

type OcrDraft = {
  extracted_text: string;
  extracted_latex: string;
  diagram_summary: string;
  figure_prompt: string;
  generated_figure_path: string;
  generated_figure_url: string;
  figure_provider: string;
};

const emptyDraft: OcrDraft = {
  extracted_text: "",
  extracted_latex: "",
  diagram_summary: "",
  figure_prompt: "",
  generated_figure_path: "",
  generated_figure_url: "",
  figure_provider: "",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 120,
  border: "1px solid #d8dee9",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  lineHeight: 1.55,
  outline: "none",
  resize: "vertical",
  background: "#fff",
  color: "#1f2937",
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
  marginBottom: 7,
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  background: "#3550c7",
  color: "#fff",
  borderRadius: 9,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid #d8dee7",
  background: "#fff",
  color: "#3550c7",
  borderRadius: 9,
  padding: "9px 13px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
};

function formatDate(value?: string | null) {
  return value || "no date";
}

function hasAnyDraftValue(draft: OcrDraft) {
  return Boolean(
    draft.extracted_text.trim() ||
      draft.extracted_latex.trim() ||
      draft.diagram_summary.trim() ||
      draft.figure_prompt.trim()
  );
}

export default function FastOcrPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingState, setMeetingState] = useState<LoadState>("idle");
  const [meetingError, setMeetingError] = useState("");

  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState("0");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  const [mode, setMode] = useState<WorkMode>("text");
  const [ocrState, setOcrState] = useState<LoadState>("idle");
  const [ocrError, setOcrError] = useState("");
  const [ocrProvider, setOcrProvider] = useState("");

  const [draft, setDraft] = useState<OcrDraft>(emptyDraft);

  const [correctionNote, setCorrectionNote] = useState("");
  const [promptState, setPromptState] = useState<LoadState>("idle");
  const [promptMessage, setPromptMessage] = useState("");

  const [figureState, setFigureState] = useState<LoadState>("idle");
  const [figureMessage, setFigureMessage] = useState("");

  const [insertState, setInsertState] = useState<LoadState>("idle");
  const [insertMessage, setInsertMessage] = useState("");
  const [insertError, setInsertError] = useState("");

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId]
  );

  const hasDraft = hasAnyDraftValue(draft);

  useEffect(() => {
    void loadMeetings();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function loadMeetings() {
    setMeetingState("loading");
    setMeetingError("");

    if (!isSupabaseConfigured) {
      setMeetingState("error");
      setMeetingError("Supabase env vars are missing.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .returns<Meeting[]>();

      if (error) throw error;

      const rows = data ?? [];
      setMeetings(rows);
      setSelectedMeetingId((current) => current || rows[0]?.id || "");
      setMeetingState("done");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "회의 목록을 불러오지 못했습니다.";

      setMeetingError(message);
      setMeetingState("error");
    }
  }

  function resetForNewFile(nextFile: File | null) {
    setFile(nextFile);
    setDraft(emptyDraft);
    setOcrProvider("");
    setCorrectionNote("");
    setOcrState("idle");
    setOcrError("");
    setPromptState("idle");
    setPromptMessage("");
    setFigureState("idle");
    setFigureMessage("");
    setInsertMessage("");
    setInsertError("");
  }

  async function runOcr() {
    if (!file) return;

    setOcrState("loading");
    setOcrError("");
    setPromptMessage("");
    setFigureMessage("");
    setInsertMessage("");
    setInsertError("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/fast-ocr", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "OCR failed");
      }

      setOcrProvider(data.provider ?? "");
      setDraft({
        extracted_text: data.extracted_text ?? "",
        extracted_latex: data.extracted_latex ?? "",
        diagram_summary: data.diagram_summary ?? "",
        figure_prompt: data.figure_prompt ?? "",
        generated_figure_path: "",
        generated_figure_url: "",
        figure_provider: "",
      });

      if (data.figure_prompt || data.diagram_summary) {
        setMode("figure");
      } else if (data.extracted_latex) {
        setMode("latex");
      } else {
        setMode("text");
      }

      setOcrState("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR failed";
      setOcrError(message);
      setOcrState("error");
    }
  }

  async function regeneratePrompt() {
    if (!correctionNote.trim()) return;

    setPromptState("loading");
    setPromptMessage("");

    try {
      const res = await fetch("/api/regenerate-figure-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentFigurePrompt: draft.figure_prompt,
          correctionNote,
          diagramSummary: draft.diagram_summary,
          extractedText: draft.extracted_text,
          extractedLatex: draft.extracted_latex,
          transcriptContext: "",
          notes: [],
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.details ?? data?.error ?? "prompt regeneration failed");
      }

      setDraft((current) => ({
        ...current,
        figure_prompt: data.figure_prompt ?? current.figure_prompt,
        generated_figure_path: "",
        generated_figure_url: "",
        figure_provider: "",
      }));

      setPromptState("done");
      setPromptMessage(`prompt updated${data.provider ? ` · ${data.provider}` : ""}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "prompt regeneration failed";
      setPromptState("error");
      setPromptMessage(message);
    }
  }

  async function generateFigure() {
    if (!draft.figure_prompt.trim()) return;

    setFigureState("loading");
    setFigureMessage("");

    try {
      const res = await fetch("/api/fast-ocr/generate-figure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          figurePrompt: draft.figure_prompt,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "figure generation failed");
      }

      setDraft((current) => ({
        ...current,
        generated_figure_path: data.generated_figure_path ?? "",
        generated_figure_url: data.generated_figure_url ?? "",
        figure_provider: data.provider ?? "",
      }));

      setFigureState("done");
      setFigureMessage(`figure generated${data.provider ? ` · ${data.provider}` : ""}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "figure generation failed";
      setFigureState("error");
      setFigureMessage(message);
    }
  }

  async function insertToMeeting() {
    if (!file || !selectedMeetingId || !hasDraft) return;

    setInsertState("loading");
    setInsertMessage("");
    setInsertError("");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("meetingId", selectedMeetingId);
      form.append("elapsedSeconds", elapsedSeconds || "0");
      form.append("provider", ocrProvider || "fast-ocr");
      form.append("extractedText", draft.extracted_text);
      form.append("extractedLatex", draft.extracted_latex);
      form.append("diagramSummary", draft.diagram_summary);
      form.append("figurePrompt", draft.figure_prompt);

      const res = await fetch("/api/fast-ocr/insert-to-meeting", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "insert failed");
      }

      setInsertState("done");
      setInsertMessage("회의에 OCR 이미지와 분석 결과를 삽입했습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "insert failed";
      setInsertError(message);
      setInsertState("error");
    }
  }

  const modeButton = (key: WorkMode, label: string, sub: string) => {
    const active = mode === key;

    return (
      <button
        key={key}
        type="button"
        onClick={() => setMode(key)}
        style={{
          border: `1px solid ${active ? "#c8d2f5" : "#e1e6ee"}`,
          background: active ? "#eef1fc" : "#fff",
          color: active ? "#3550c7" : "#64748b",
          borderRadius: 10,
          padding: "10px 12px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 3 }}>
          {label}
        </div>
        <div className="mono" style={{ fontSize: 10.5, opacity: 0.72 }}>
          {sub}
        </div>
      </button>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: "36px 30px 80px",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
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
              FAST OCR
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 750,
                letterSpacing: "-.02em",
              }}
            >
              회의 없이 OCR · 수식 · 그림 생성
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                color: "#64748b",
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              이미지를 먼저 OCR하고, 수식/텍스트를 복사하거나 figure prompt로 바로 그림을 생성합니다.
              회의 삽입은 별도 버튼으로 수행합니다.
            </p>
          </div>

          <Link
            href="/meetings"
            style={{
              border: "1px solid #d8dee7",
              background: "#fff",
              color: "#3550c7",
              borderRadius: 9,
              padding: "9px 15px",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            회의 목록 →
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "380px minmax(0, 1fr)",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <section
              style={{
                background: "#fff",
                border: "1px solid #e4e8ef",
                borderRadius: 13,
                padding: 16,
                boxShadow: "0 1px 3px rgba(20,30,50,.04)",
              }}
            >
              <div style={labelStyle}>이미지 업로드</div>

              <input
                id="fast-ocr-file-input"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  resetForNewFile(nextFile);
                }}
                style={{ display: "none" }}
              />

              <label
                htmlFor="fast-ocr-file-input"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  minHeight: 44,
                  border: "1px dashed #b9c3d2",
                  background: "#f8fafc",
                  color: "#3550c7",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                이미지 선택
              </label>

              {file && (
                <div
                  style={{
                    marginTop: 9,
                    fontSize: 12,
                    color: "#64748b",
                    lineHeight: 1.45,
                    wordBreak: "break-all",
                  }}
                >
                  선택됨: <b>{file.name}</b>
                </div>
              )}

              {previewUrl && (
                <div
                  style={{
                    marginTop: 14,
                    border: "1px solid #e4e8ef",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "#f8fafc",
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="OCR preview"
                    style={{
                      display: "block",
                      width: "100%",
                      maxHeight: 360,
                      objectFit: "contain",
                    }}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={runOcr}
                disabled={!file || ocrState === "loading"}
                style={{
                  ...primaryButtonStyle,
                  width: "100%",
                  marginTop: 14,
                  opacity: !file || ocrState === "loading" ? 0.55 : 1,
                  cursor: !file || ocrState === "loading" ? "default" : "pointer",
                }}
              >
                {ocrState === "loading" ? "OCR 중..." : "Run OCR"}
              </button>

              {ocrProvider && (
                <div
                  className="mono"
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: "#3550c7",
                    background: "#eef1fc",
                    border: "1px solid #dde3f7",
                    borderRadius: 7,
                    padding: "6px 8px",
                  }}
                >
                  {ocrProvider}
                </div>
              )}

              {ocrError && (
                <div
                  style={{
                    marginTop: 12,
                    color: "#b91c1c",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 9,
                    padding: "9px 11px",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                  }}
                >
                  {ocrError}
                </div>
              )}
            </section>

            <section
              style={{
                background: "#fff",
                border: "1px solid #e4e8ef",
                borderRadius: 13,
                padding: 16,
                boxShadow: "0 1px 3px rgba(20,30,50,.04)",
              }}
            >
              <div style={labelStyle}>회의에 삽입</div>

              <select
                value={selectedMeetingId}
                onChange={(event) => setSelectedMeetingId(event.target.value)}
                disabled={meetingState === "loading"}
                style={{
                  width: "100%",
                  border: "1px solid #d8dee9",
                  borderRadius: 9,
                  padding: "9px 10px",
                  fontSize: 13,
                  background: "#fff",
                }}
              >
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {formatDate(meeting.date)} · {meeting.title}
                  </option>
                ))}
              </select>

              {meetingError && (
                <div
                  style={{
                    marginTop: 10,
                    color: "#b91c1c",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                  }}
                >
                  {meetingError}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div style={labelStyle}>elapsed seconds</div>
                <input
                  value={elapsedSeconds}
                  onChange={(event) => setElapsedSeconds(event.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  style={{
                    width: "100%",
                    border: "1px solid #d8dee9",
                    borderRadius: 9,
                    padding: "9px 10px",
                    fontSize: 13,
                  }}
                />
              </div>

              {selectedMeeting && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: "#64748b",
                    lineHeight: 1.45,
                  }}
                >
                  선택됨: <b>{selectedMeeting.title}</b>
                </div>
              )}

              <button
                type="button"
                onClick={insertToMeeting}
                disabled={
                  !file ||
                  !hasDraft ||
                  !selectedMeetingId ||
                  insertState === "loading"
                }
                style={{
                  ...primaryButtonStyle,
                  width: "100%",
                  marginTop: 14,
                  background: "#1f2937",
                  opacity:
                    !file ||
                    !hasDraft ||
                    !selectedMeetingId ||
                    insertState === "loading"
                      ? 0.55
                      : 1,
                  cursor:
                    !file ||
                    !hasDraft ||
                    !selectedMeetingId ||
                    insertState === "loading"
                      ? "default"
                      : "pointer",
                }}
              >
                {insertState === "loading" ? "삽입 중..." : "Insert to meeting"}
              </button>

              {insertMessage && (
                <div
                  style={{
                    marginTop: 12,
                    color: "#166534",
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: 9,
                    padding: "9px 11px",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                  }}
                >
                  {insertMessage}
                </div>
              )}

              {insertError && (
                <div
                  style={{
                    marginTop: 12,
                    color: "#b91c1c",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 9,
                    padding: "9px 11px",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                  }}
                >
                  {insertError}
                </div>
              )}
            </section>
          </div>

          <section
            style={{
              background: "#fff",
              border: "1px solid #e4e8ef",
              borderRadius: 13,
              padding: 18,
              boxShadow: "0 1px 3px rgba(20,30,50,.04)",
              minHeight: 620,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "#8a93a3",
                    letterSpacing: ".04em",
                    marginBottom: 5,
                  }}
                >
                  OCR WORKSPACE
                </div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 750 }}>
                  결과 확인 · 프롬프트 · 그림 생성
                </h2>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 18,
              }}
            >
              {modeButton("text", "Text", "plain OCR")}
              {modeButton("latex", "LaTeX", "equations")}
              {modeButton("figure", "Figure", "prompt + image")}
            </div>

            {!hasDraft ? (
              <div
                style={{
                  border: "1px dashed #d5dce6",
                  borderRadius: 12,
                  padding: 32,
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                }}
              >
                이미지를 업로드하고 Run OCR을 누르면 결과가 여기에 표시됩니다.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {mode === "text" && (
                  <div>
                    <div style={labelStyle}>Extracted text</div>
                    <textarea
                      value={draft.extracted_text}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extracted_text: event.target.value,
                        }))
                      }
                      style={{ ...textareaStyle, minHeight: 360 }}
                    />
                  </div>
                )}

                {mode === "latex" && (
                  <div>
                    <div style={labelStyle}>Extracted LaTeX</div>
                    <textarea
                      value={draft.extracted_latex}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extracted_latex: event.target.value,
                        }))
                      }
                      style={{
                        ...textareaStyle,
                        minHeight: 360,
                        fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                    />
                  </div>
                )}

                {mode === "figure" && (
                  <div style={{ display: "grid", gap: 16 }}>
                    <div>
                      <div style={labelStyle}>Diagram summary</div>
                      <textarea
                        value={draft.diagram_summary}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            diagram_summary: event.target.value,
                          }))
                        }
                        style={{ ...textareaStyle, minHeight: 110 }}
                      />
                    </div>

                    <div>
                      <div style={labelStyle}>Figure prompt</div>
                      <textarea
                        value={draft.figure_prompt}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            figure_prompt: event.target.value,
                            generated_figure_path: "",
                            generated_figure_url: "",
                            figure_provider: "",
                          }))
                        }
                        style={{ ...textareaStyle, minHeight: 180 }}
                      />
                    </div>

                    <div>
                      <div style={labelStyle}>Correction note for prompt regeneration</div>
                      <textarea
                        value={correctionNote}
                        onChange={(event) => setCorrectionNote(event.target.value)}
                        placeholder="예: unclear라고 나온 부분을 retrieved data로 바꾸고, 왼쪽에서 오른쪽으로 흐르는 구조로 정리"
                        style={{ ...textareaStyle, minHeight: 80 }}
                      />

                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={regeneratePrompt}
                          disabled={!correctionNote.trim() || promptState === "loading"}
                          style={{
                            ...secondaryButtonStyle,
                            opacity:
                              !correctionNote.trim() || promptState === "loading"
                                ? 0.55
                                : 1,
                            cursor:
                              !correctionNote.trim() || promptState === "loading"
                                ? "default"
                                : "pointer",
                          }}
                        >
                          {promptState === "loading" ? "Regenerating..." : "Regenerate prompt"}
                        </button>

                        <button
                          type="button"
                          onClick={generateFigure}
                          disabled={!draft.figure_prompt.trim() || figureState === "loading"}
                          style={{
                            ...primaryButtonStyle,
                            opacity:
                              !draft.figure_prompt.trim() || figureState === "loading"
                                ? 0.55
                                : 1,
                            cursor:
                              !draft.figure_prompt.trim() || figureState === "loading"
                                ? "default"
                                : "pointer",
                          }}
                        >
                          {figureState === "loading" ? "Generating..." : "Generate figure"}
                        </button>
                      </div>

                      {promptMessage && (
                        <div
                          className="mono"
                          style={{
                            marginTop: 9,
                            fontSize: 11,
                            color: promptState === "error" ? "#b91c1c" : "#64748b",
                          }}
                        >
                          {promptMessage}
                        </div>
                      )}

                      {figureMessage && (
                        <div
                          className="mono"
                          style={{
                            marginTop: 9,
                            fontSize: 11,
                            color: figureState === "error" ? "#b91c1c" : "#64748b",
                          }}
                        >
                          {figureMessage}
                        </div>
                      )}
                    </div>

                    {draft.generated_figure_url && (
                      <div
                        style={{
                          border: "1px solid #e4e8ef",
                          borderRadius: 12,
                          background: "#fbfcfe",
                          padding: 12,
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "#64748b" }}
                        >
                          {draft.figure_provider || "generated figure"}
                        </div>

                        <img
                          src={draft.generated_figure_url}
                          alt="Generated figure"
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid #e5e7eb",
                            background: "#fff",
                          }}
                        />

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <a
                            href={draft.generated_figure_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              ...secondaryButtonStyle,
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            Open image
                          </a>

                          <a
                            href={draft.generated_figure_url}
                            download
                            style={{
                              ...primaryButtonStyle,
                              background: "#1f2937",
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            Download PNG
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}