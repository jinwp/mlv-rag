"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  MEETING_MODE_OPTIONS,
  type MeetingMode,
} from "@/lib/meetings/modes";

const PROJECT_CHIPS = ["VLA 로봇팔", "SBQ 논문"];

type CreateMode = "record" | "upload" | "empty";

const inputBase: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d8dee7",
  borderRadius: 9,
  padding: "11px 13px",
  fontSize: 14.5,
  color: "#1b2231",
  outline: "none",
  background: "#fbfcfe",
};

const modeCardBase: React.CSSProperties = {
  border: "1px solid #e1e6ee",
  borderRadius: 12,
  padding: "14px 15px",
  background: "#fff",
  textAlign: "left",
  cursor: "pointer",
};

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function audioStoragePath(meetingId: string, file: File) {
  const name = file.name || "audio";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() || "webm" : "webm";
  const base = safePathPart(name.replace(/\.[^.]+$/, "")) || "audio";
  return `${meetingId}/audio/${Date.now()}-${base}.${ext}`;
}

export default function NewMeetingPage() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [project, setProject] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("meeting");
  const [agenda, setAgenda] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [partDraft, setPartDraft] = useState("");

  const [createMode, setCreateMode] = useState<CreateMode>("record");
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    title.trim().length > 0 &&
    !submitting &&
    (createMode !== "upload" || audioFile !== null);

  function addPart() {
    const v = partDraft.replace(/,\s*$/, "").trim();
    if (!v) return;
    setParticipants((p) => [...p, v]);
    setPartDraft("");
  }

  function removePart(i: number) {
    setParticipants((p) => p.filter((_, j) => j !== i));
  }

  async function createMeeting() {
    const { data, error } = await supabase
      .from("meetings")
      .insert({
        title: title.trim(),
        date,
        participants,
        project_tag: project.trim() || "미분류",
        mode: meetingMode,
        agenda: agenda.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "회의를 생성하지 못했습니다.");
    }

    return data.id as string;
  }

  async function uploadAudioAndCreateTranscript(meetingId: string, file: File) {
    const storagePath = audioStoragePath(meetingId, file);

    setStatus("음성 파일 업로드 중...");

    const { error: uploadError } = await supabase.storage
      .from("meeting-media")
      .upload(storagePath, file, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    setStatus("전사 placeholder 생성 중...");

    const { error: transcriptError } = await supabase.from("transcripts").insert({
      meeting_id: meetingId,
      storage_path: storagePath,
      raw_text: "",
      refined_text: null,
      provider: "uploaded-audio",
    });

    if (transcriptError) {
      throw new Error(transcriptError.message);
    }

    return storagePath;
  }

  async function onSubmit() {
    if (!canSubmit) return;

    setSubmitting(true);
    setStatus("");
    setError(null);

    try {
      setStatus("회의 생성 중...");
      const meetingId = await createMeeting();

      if (createMode === "record") {
        router.push(`/meetings/${meetingId}/record`);
        return;
      }

      if (createMode === "upload") {
        if (!audioFile) throw new Error("업로드할 음성 파일을 선택하세요.");
        await uploadAudioAndCreateTranscript(meetingId, audioFile);
        router.push(`/meetings/${meetingId}`);
        return;
      }

      router.push(`/meetings/${meetingId}`);
    } catch (err) {
      setSubmitting(false);
      setStatus("");
      setError(err instanceof Error ? err.message : "회의를 생성하지 못했습니다.");
    }
  }

  function modeCard(mode: CreateMode, title: string, description: string, action: string) {
    const active = createMode === mode;

    return (
      <button
        type="button"
        onClick={() => setCreateMode(mode)}
        style={{
          ...modeCardBase,
          ...(active
            ? {
              border: "1px solid #c8d2f5",
              background: "#f5f7ff",
              boxShadow: "inset 2px 0 0 #3550c7, 0 1px 2px rgba(20,30,50,.05)",
            }
          : {}),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 6,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: active ? "#3550c7" : "#c2cad6",
              flex: "none",
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 750, color: "#1b2231" }}>
            {title}
          </span>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "#64748b", marginBottom: 7 }}>
          {description}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: active ? "#3550c7" : "#94a3b8" }}>
          {action}
        </div>
      </button>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "48px 24px 80px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          className="mono"
          style={{ fontSize: 11, color: "#8a93a3", letterSpacing: ".04em", marginBottom: 6 }}
        >
          NEW SESSION
        </div>
        <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 4px" }}>
          새 회의 만들기
        </h1>
        <p style={{ margin: "0 0 30px", color: "#6b7482", fontSize: 14, lineHeight: 1.5 }}>
          회의 메타데이터를 먼저 만들고, 녹음·음성 업로드·빈 세션 중 하나를 선택합니다.
        </p>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e4e8ef",
            borderRadius: 14,
            padding: "26px 28px",
            boxShadow: "0 1px 3px rgba(20,30,50,.04)",
          }}
        >
          {/* 제목 */}
          <label style={{ display: "block", marginBottom: 22 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
              제목
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: VLA 로봇팔 — grasp 정책 리뷰"
              style={inputBase}
            />
          </label>

          {/* 날짜 + 프로젝트 + 모드 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "200px minmax(0, 1fr) 210px",
              gap: 16,
              marginBottom: 22,
              alignItems: "start",
            }}
          >
            <label>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
                날짜
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mono"
                style={{ ...inputBase, padding: "10px 13px", fontSize: 13.5 }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
                프로젝트 태그
              </div>
              <input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="예: VLA 로봇팔"
                style={{ ...inputBase, padding: "10px 13px", fontSize: 14 }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {PROJECT_CHIPS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setProject(c)}
                    className="mono"
                    style={{
                      border: "1px solid #dfe4ec",
                      background: "#f2f5fa",
                      color: "#5b6472",
                      borderRadius: 20,
                      padding: "4px 11px",
                      fontSize: 12,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </label>

            <label>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
                Mode
              </div>
              <select
                value={meetingMode}
                onChange={(e) => setMeetingMode(e.target.value as MeetingMode)}
                style={{ ...inputBase, padding: "10px 13px", fontSize: 14 }}
              >
                {MEETING_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#8a93a3", lineHeight: 1.45 }}>
                {MEETING_MODE_OPTIONS.find((option) => option.value === meetingMode)?.description}
              </div>
            </label>
          </div>

          {/* 참여자 */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
              참여자
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 7,
                alignItems: "center",
                border: "1px solid #d8dee7",
                borderRadius: 9,
                padding: "8px 9px",
                background: "#fbfcfe",
                minHeight: 44,
              }}
            >
              {participants.map((p, i) => (
                <span
                  key={`${p}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#eef1fc",
                    color: "#33417f",
                    border: "1px solid #dbe1f6",
                    borderRadius: 20,
                    padding: "4px 6px 4px 11px",
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePart(i)}
                    style={{
                      border: "none",
                      background: "#d6def6",
                      color: "#5361a8",
                      width: 17,
                      height: 17,
                      borderRadius: "50%",
                      cursor: "pointer",
                      fontSize: 11,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={partDraft}
                onChange={(e) => setPartDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addPart();
                  }
                }}
                placeholder="이름 입력 후 Enter"
                style={{
                  flex: 1,
                  minWidth: 140,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 14,
                  padding: "4px 6px",
                  color: "#1b2231",
                }}
              />
            </div>
          </div>

          {/* 안건 */}
          <label style={{ display: "block", marginBottom: 24 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 7 }}>
              안건 / 메모
            </div>
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={4}
              placeholder="이번 회의에서 다룰 것 — 자유롭게"
              style={{ ...inputBase, fontSize: 14, lineHeight: 1.55 }}
            />
          </label>

          {/* 생성 방식 */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 9 }}>
              세션 생성 방식
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {modeCard(
                "record",
                "바로 녹음",
                "회의를 만든 뒤 녹음 화면으로 이동합니다.",
                "/meetings/{id}/record"
              )}
              {modeCard(
                "upload",
                "음성 파일 업로드",
                "이미 녹음된 파일을 회의에 연결합니다.",
                "audio → transcript placeholder"
              )}
              {modeCard(
                "empty",
                "빈 세션",
                "녹음 없이 회의 메모/사진/RAG용 세션만 만듭니다.",
                "/meetings/{id}"
              )}
            </div>
          </div>

          {createMode === "upload" && (
            <div
              style={{
                marginBottom: 22,
                border: "1px solid #e4e8ef",
                borderRadius: 12,
                background: "#fbfcfe",
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252", marginBottom: 8 }}>
                음성 파일
              </div>

              <input
                id="meeting-audio-file"
                type="file"
                accept="audio/*,video/webm,video/mp4"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />

              <label
                htmlFor="meeting-audio-file"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 42,
                  border: "1px dashed #b9c3d2",
                  background: "#fff",
                  color: "#3550c7",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                음성 파일 선택
              </label>

              {audioFile && (
                <div
                  style={{
                    marginTop: 9,
                    fontSize: 12,
                    color: "#64748b",
                    lineHeight: 1.45,
                    wordBreak: "break-all",
                  }}
                >
                  선택됨: <b>{audioFile.name}</b> · {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                </div>
              )}

              <div style={{ marginTop: 9, fontSize: 12, color: "#8a93a3", lineHeight: 1.45 }}>
                현재 구현은 음성 파일을 storage에 저장하고 transcript placeholder를 생성합니다.
                자동 전사는 기존 transcription API와 연결하면 추가할 수 있습니다.
              </div>
            </div>
          )}

          {status && (
            <div
              className="mono"
              style={{
                marginBottom: 14,
                fontSize: 12,
                color: "#3550c7",
                background: "#eef1fc",
                border: "1px solid #dde3f7",
                borderRadius: 9,
                padding: "9px 12px",
              }}
            >
              {status}
            </div>
          )}

          {error && (
            <div
              style={{
                marginBottom: 14,
                fontSize: 13,
                color: "#c0323a",
                background: "#fdecec",
                border: "1px solid #f3caca",
                borderRadius: 9,
                padding: "9px 12px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              width: "100%",
              border: "none",
              borderRadius: 10,
              padding: 14,
              fontSize: 15,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              letterSpacing: "-.01em",
              ...(canSubmit
                ? { background: "#3550c7", color: "#fff" }
                : { background: "#e4e8ef", color: "#a6afbd" }),
            }}
          >
            {submitting
              ? "생성 중…"
              : createMode === "record"
                ? "● 회의 생성 후 녹음 시작 →"
                : createMode === "upload"
                  ? "↑ 회의 생성 후 음성 업로드 →"
                  : "＋ 녹음 없이 회의 만들기 →"}
          </button>
        </div>
      </div>
    </div>
  );
}