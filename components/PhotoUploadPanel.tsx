"use client";

import { useMemo, useRef, useState } from "react";
import { supabase, publicUrl, MEDIA_BUCKET } from "@/lib/supabaseClient";
import { fmtLog } from "@/lib/format";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";

type AnalysisMode = "text" | "equation" | "diagram";

type Draft = {
  mode: AnalysisMode;
  text: string;
  latex: string;
  diagram_summary: string;
  figure_prompt: string;
  generated_figure_path: string;
  figure_provider: string;
  feedback: string;
};

type Props = {
  meeting: Meeting;
  initialPhotos: Photo[];
  transcripts: Transcript[];
  notes: Note[];
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
  fontSize: 12,
};

const primaryButton: React.CSSProperties = {
  ...button,
  background: "#111827",
  color: "#fff",
  borderColor: "#111827",
};

const dangerButton: React.CSSProperties = {
  ...button,
  color: "#991b1b",
  borderColor: "#fecaca",
  background: "#fff7f7",
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 74,
  border: "1px solid #d8dee9",
  borderRadius: 8,
  padding: 9,
  fontSize: 12.5,
  lineHeight: 1.5,
  resize: "vertical",
  fontFamily: "inherit",
};

function safeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isUploadedImage(photo: Photo) {
  return photo.storage_path.includes("/uploads/");
}

function defaultMode(photo: Photo): AnalysisMode {
  const saved = photo.analysis_modes?.[0];

  if (saved === "text" || saved === "equation" || saved === "diagram") {
    return saved;
  }

  return "text";
}

function draftFromPhoto(photo: Photo): Draft {
  return {
    mode: defaultMode(photo),
    text: photo.extracted_text ?? "",
    latex: photo.extracted_latex ?? "",
    diagram_summary: photo.diagram_summary ?? "",
    figure_prompt: photo.figure_prompt ?? "",
    generated_figure_path: photo.generated_figure_path ?? "",
    figure_provider: photo.figure_provider ?? "",
    feedback: photo.analysis_feedback ?? "",
  };
}

function modeLabel(mode: AnalysisMode) {
  if (mode === "text") return "Text";
  if (mode === "equation") return "Equation";
  return "Diagram";
}

function fileNameFromPath(path: string) {
  const name = path.split("/").pop()?.trim();
  return name || "generated-figure.png";
}

async function downloadImageFromUrl(url: string, filename: string) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(objectUrl);
}

function getResultForMode(data: any, mode: AnalysisMode, fallback: Draft) {
  if (typeof data?.result?.value === "string") {
    return data.result.value;
  }

  if (mode === "text") {
    return data?.result?.text ?? fallback.text;
  }

  if (mode === "equation") {
    return data?.result?.latex ?? fallback.latex;
  }

  return data?.result?.diagram_summary ?? fallback.diagram_summary;
}

export function PhotoUploadPanel({
  meeting,
  initialPhotos,
  transcripts,
  notes,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialPhotos.map((p) => [p.id, draftFromPhoto(p)]))
  );
  const [uploading, setUploading] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const transcriptContext = useMemo(() => {
    return transcripts
      .map((t) => t.refined_text || t.full_text)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000);
  }, [transcripts]);

  function ensureDraft(photo: Photo) {
    return drafts[photo.id] ?? draftFromPhoto(photo);
  }

  function updateDraft(photoId: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const photo = photos.find((p) => p.id === photoId);
      const current = prev[photoId] ?? (photo ? draftFromPhoto(photo) : null);

      if (!current) return prev;

      return {
        ...prev,
        [photoId]: {
          ...current,
          ...patch,
        },
      };
    });
  }

  async function uploadImages(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const uploaded: Photo[] = [];

      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        const timestamp = Date.now();
        const filename = safeFileName(file.name || "uploaded-image.png");
        const storagePath = `${meeting.id}/uploads/${timestamp}-${filename}`;

        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { data, error: insertError } = await supabase
          .from("photos")
          .insert({
            meeting_id: meeting.id,
            storage_path: storagePath,
            elapsed_seconds: 0,
            analysis_status: "not_analyzed",
          })
          .select("*")
          .single<Photo>();

        if (insertError) throw insertError;
        if (data) uploaded.push(data);
      }

      setPhotos((prev) => [...uploaded, ...prev]);

      setDrafts((prev) => ({
        ...Object.fromEntries(uploaded.map((p) => [p.id, draftFromPhoto(p)])),
        ...prev,
      }));

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (err: any) {
      console.error("[PhotoUploadPanel] upload failed", err);
      setError(err?.message ?? "Image upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function analyzePhoto(photo: Photo, useFeedback: boolean) {
    const draft = ensureDraft(photo);

    setBusyPhotoId(photo.id);
    setError(null);

    try {
      const res = await fetch("/api/analyze-photo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storagePath: photo.storage_path,
          mode: draft.mode,
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
          transcriptContext,
          feedback: useFeedback ? draft.feedback : "",
          previousDraft: useFeedback
            ? {
                text: draft.text,
                latex: draft.latex,
                diagram_summary: draft.diagram_summary,
                figure_prompt: draft.figure_prompt,
              }
            : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Photo analysis failed");
      }

      const value = getResultForMode(data, draft.mode, draft);

      if (draft.mode === "text") {
        updateDraft(photo.id, { text: value });
      } else if (draft.mode === "equation") {
        updateDraft(photo.id, { latex: value });
      } else {
        updateDraft(photo.id, {
          diagram_summary: data.result?.diagram_summary ?? value,
          figure_prompt: data.result?.figure_prompt ?? draft.figure_prompt,
        });
      }

      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id ? { ...p, analysis_status: "draft" } : p
        )
      );
    } catch (err: any) {
      console.error("[PhotoUploadPanel] analysis failed", err);
      setError(err?.message ?? "Photo analysis failed");
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function saveDraft(photo: Photo) {
    const draft = ensureDraft(photo);

    setBusyPhotoId(photo.id);
    setError(null);

    try {
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("photos")
        .update({
          analysis_status: "saved",
          analysis_modes: [draft.mode],
          extracted_text: draft.text || null,
          extracted_latex: draft.latex || null,
          diagram_summary: draft.diagram_summary || null,
          figure_prompt: draft.figure_prompt || null,
          analysis_feedback: draft.feedback || null,
          analyzed_at: now,
        })
        .eq("id", photo.id);

      if (updateError) throw updateError;

      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                analysis_status: "saved",
                analysis_modes: [draft.mode],
                extracted_text: draft.text,
                extracted_latex: draft.latex,
                diagram_summary: draft.diagram_summary,
                figure_prompt: draft.figure_prompt,
                analysis_feedback: draft.feedback,
                analyzed_at: now,
              }
            : p
        )
      );
    } catch (err: any) {
      console.error("[PhotoUploadPanel] save failed", err);
      setError(err?.message ?? "Save failed");
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function generateFigure(photo: Photo) {
    const draft = ensureDraft(photo);

    if (!draft.figure_prompt.trim()) {
      setError(
        "Figure prompt is empty. Run Diagram analysis first or write a prompt."
      );
      return;
    }

    setBusyPhotoId(photo.id);
    setError(null);

    try {
      const res = await fetch("/api/generate-figure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          photoId: photo.id,
          meetingId: meeting.id,
          figurePrompt: draft.figure_prompt,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? "Figure generation failed");
      }

      updateDraft(photo.id, {
        generated_figure_path: data.generated_figure_path ?? "",
        figure_provider: data.provider ?? "",
      });

      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? {
                ...p,
                figure_prompt: draft.figure_prompt,
                generated_figure_path: data.generated_figure_path,
                figure_provider: data.provider,
                figure_generated_at: data.figure_generated_at,
              }
            : p
        )
      );
    } catch (err: any) {
      console.error("[PhotoUploadPanel] figure generation failed", err);
      setError(err?.message ?? "Figure generation failed");
    } finally {
      setBusyPhotoId(null);
    }
  }

  async function downloadGeneratedFigure(photo: Photo) {
    const draft = ensureDraft(photo);
    const generatedPath =
      draft.generated_figure_path || photo.generated_figure_path || "";

    if (!generatedPath) {
      setError("No generated figure to download.");
      return;
    }

    const url = publicUrl(generatedPath);

    if (!url) {
      setError("Failed to resolve generated figure URL.");
      return;
    }

    setError(null);

    try {
      await downloadImageFromUrl(url, fileNameFromPath(generatedPath));
    } catch (err: any) {
      console.error("[PhotoUploadPanel] download failed", err);
      setError(err?.message ?? "Download failed");
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function deletePhoto(photo: Photo) {
    const ok = window.confirm(
      "이 이미지를 OCR 후보에서 삭제할까요? 저장된 OCR 결과와 생성된 figure도 함께 삭제됩니다."
    );

    if (!ok) return;

    setBusyPhotoId(photo.id);
    setError(null);

    try {
      const { error: deleteRowError } = await supabase
        .from("photos")
        .delete()
        .eq("id", photo.id);

      if (deleteRowError) {
        throw deleteRowError;
      }

      const pathsToRemove = [
        photo.storage_path,
        photo.generated_figure_path,
      ].filter(Boolean) as string[];

      if (pathsToRemove.length > 0) {
        const { error: removeStorageError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .remove(pathsToRemove);

        if (removeStorageError) {
          console.warn(
            "[PhotoUploadPanel] storage remove failed",
            removeStorageError
          );
        }
      }

      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));

      setDrafts((prev) => {
        const next = { ...prev };
        delete next[photo.id];
        return next;
      });
    } catch (err: any) {
      console.error("[PhotoUploadPanel] delete failed", err);
      setError(err?.message ?? "Delete failed");
    } finally {
      setBusyPhotoId(null);
    }
  }

  return (
    <div style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#3a4252" }}>
            OCR 후보 이미지
          </div>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
            select one: text · equation · diagram
          </div>
        </div>

        <span className="mono" style={{ fontSize: 10.5, color: "#aab2c0" }}>
          {photos.length} shots
        </span>
      </div>

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div
          style={{
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            padding: 12,
            background: "#f8fafc",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.45 }}>
            회의 중 캡처한 이미지와 업로드한 이미지를 같은 OCR 후보로
            처리합니다.
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => uploadImages(e.target.files)}
            style={{ display: "none" }}
          />

          <button
            type="button"
            style={primaryButton}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading..." : "Upload images"}
          </button>

          {error && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: "#fef2f2",
                color: "#991b1b",
                border: "1px solid #fecaca",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {photos.map((p) => {
            const url = publicUrl(p.storage_path);
            const uploaded = isUploadedImage(p);
            const draft = ensureDraft(p);
            const busy = busyPhotoId === p.id;
            const generatedPath =
              draft.generated_figure_path || p.generated_figure_path || "";
            const generatedUrl = generatedPath ? publicUrl(generatedPath) : null;

            return (
              <div
                key={p.id}
                style={{
                  border: "1px solid #e0e5ee",
                  borderRadius: 11,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={
                      uploaded
                        ? "uploaded OCR candidate"
                        : `capture at ${fmtLog(p.elapsed_seconds)}`
                    }
                    style={{
                      width: "100%",
                      display: "block",
                      aspectRatio: "16/9",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    className="mono"
                    style={{
                      aspectRatio: "16/9",
                      backgroundColor: "#f6f8fb",
                      backgroundImage:
                        "linear-gradient(#e6ebf3 1px,transparent 1px),linear-gradient(90deg,#e6ebf3 1px,transparent 1px)",
                      backgroundSize: "16px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: "#b3bcc9",
                      letterSpacing: ".05em",
                    }}
                  >
                    WHITEBOARD
                  </div>
                )}

                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "#7a8496",
                    padding: "5px 8px",
                    borderTop: "1px solid #eef1f5",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>
                    {uploaded ? "uploaded" : `[${fmtLog(p.elapsed_seconds)}]`}
                  </span>
                  <span>{p.analysis_status ?? "not_analyzed"}</span>
                </div>

                <div style={{ padding: 11, display: "grid", gap: 10 }}>
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      fontSize: 12,
                      color: "#334155",
                    }}
                  >
                    {(["text", "equation", "diagram"] as AnalysisMode[]).map(
                      (mode) => (
                        <label
                          key={mode}
                          style={{
                            display: "inline-flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="radio"
                            name={`analysis-mode-${p.id}`}
                            checked={draft.mode === mode}
                            onChange={() => updateDraft(p.id, { mode })}
                          />
                          {modeLabel(mode)}
                        </label>
                      )
                    )}
                  </div>

                  <button
                    type="button"
                    style={primaryButton}
                    disabled={busy}
                    onClick={() => analyzePhoto(p, false)}
                  >
                    {busy
                      ? "Analyzing..."
                      : `Analyze ${modeLabel(draft.mode)}`}
                  </button>

                  {draft.mode === "text" && (
                    <div style={{ display: "grid", gap: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Text</div>
                      <textarea
                        style={textarea}
                        value={draft.text}
                        onChange={(e) =>
                          updateDraft(p.id, { text: e.target.value })
                        }
                        placeholder="Extracted plain text"
                      />
                    </div>
                  )}

                  {draft.mode === "equation" && (
                    <div style={{ display: "grid", gap: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>
                        Equation (LaTeX)
                      </div>
                      <textarea
                        style={{ ...textarea, fontFamily: "monospace" }}
                        value={draft.latex}
                        onChange={(e) =>
                          updateDraft(p.id, { latex: e.target.value })
                        }
                        placeholder="Extracted LaTeX"
                      />
                    </div>
                  )}

                  {draft.mode === "diagram" && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 5 }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>
                          Diagram
                        </div>
                        <textarea
                          style={textarea}
                          value={draft.diagram_summary}
                          onChange={(e) =>
                            updateDraft(p.id, {
                              diagram_summary: e.target.value,
                            })
                          }
                          placeholder="Diagram nodes, arrows, labels, and flow"
                        />
                      </div>

                      <div style={{ display: "grid", gap: 5 }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>
                          Figure prompt
                        </div>
                        <textarea
                          style={{ ...textarea, minHeight: 110 }}
                          value={draft.figure_prompt}
                          onChange={(e) =>
                            updateDraft(p.id, {
                              figure_prompt: e.target.value,
                            })
                          }
                          placeholder="Text-only image generation prompt for a clean academic figure"
                        />
                      </div>

                      <button
                        type="button"
                        style={primaryButton}
                        disabled={busy}
                        onClick={() => generateFigure(p)}
                      >
                        {busy ? "Generating figure..." : "Generate figure"}
                      </button>

                      {generatedUrl && (
                        <div
                          style={{
                            display: "grid",
                            gap: 6,
                            border: "1px solid #e5e7eb",
                            borderRadius: 9,
                            padding: 8,
                            background: "#f8fafc",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span>Generated figure</span>
                            <span
                              className="mono"
                              style={{ fontSize: 10.5, color: "#64748b" }}
                            >
                              {draft.figure_provider ||
                                p.figure_provider ||
                                "generated"}
                            </span>
                          </div>

                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={generatedUrl}
                            alt="generated academic figure"
                            style={{
                              width: "100%",
                              display: "block",
                              borderRadius: 7,
                              border: "1px solid #e5e7eb",
                              background: "#fff",
                            }}
                          />

                          <button
                            type="button"
                            style={button}
                            disabled={busy}
                            onClick={() => downloadGeneratedFigure(p)}
                          >
                            Download PNG
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "grid", gap: 5 }}>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>
                      Correction note
                    </div>
                    <textarea
                      style={{ ...textarea, minHeight: 58 }}
                      value={draft.feedback}
                      onChange={(e) =>
                        updateDraft(p.id, { feedback: e.target.value })
                      }
                      placeholder="틀린 수식, 누락된 텍스트, 잘못 해석한 다이어그램을 적으면 regenerate에 반영됩니다."
                    />
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      onClick={() => analyzePhoto(p, true)}
                    >
                      Regenerate with feedback
                    </button>

                    <button
                      type="button"
                      style={primaryButton}
                      disabled={busy}
                      onClick={() => saveDraft(p)}
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      style={dangerButton}
                      disabled={busy}
                      onClick={() => deletePhoto(p)}
                    >
                      Delete image
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {photos.length === 0 && (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: "#aab2c0",
                fontSize: 12.5,
              }}
            >
              이미지 없음
            </div>
          )}
        </div>
      </div>
    </div>
  );
}