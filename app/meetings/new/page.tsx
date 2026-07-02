"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const PROJECT_CHIPS = ["VLA 로봇팔", "SBQ 논문"];

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

export default function NewMeetingPage() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [project, setProject] = useState("");
  const [agenda, setAgenda] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [partDraft, setPartDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && !submitting;

  function addPart() {
    const v = partDraft.replace(/,\s*$/, "").trim();
    if (!v) return;
    setParticipants((p) => [...p, v]);
    setPartDraft("");
  }
  function removePart(i: number) {
    setParticipants((p) => p.filter((_, j) => j !== i));
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { data, error } = await supabase
      .from("meetings")
      .insert({
        title: title.trim(),
        date,
        participants,
        project_tag: project.trim() || "미분류",
        agenda: agenda.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      setSubmitting(false);
      setError(error?.message ?? "회의를 생성하지 못했습니다.");
      return;
    }
    router.push(`/meetings/${data.id}/record`);
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "48px 24px 80px" }}>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        <div
          className="mono"
          style={{ fontSize: 11, color: "#8a93a3", letterSpacing: ".04em", marginBottom: 6 }}
        >
          NEW SESSION
        </div>
        <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-.02em", margin: "0 0 4px" }}>
          새 회의 시작
        </h1>
        <p style={{ margin: "0 0 30px", color: "#6b7482", fontSize: 14, lineHeight: 1.5 }}>
          녹음 전 메타데이터를 채워두면, 나중에 검색·인용할 때 이 정보로 찾습니다.
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

          {/* 날짜 + 프로젝트 */}
          <div style={{ display: "flex", gap: 16, marginBottom: 22 }}>
            <label style={{ flex: "0 0 200px" }}>
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
            <label style={{ flex: 1 }}>
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
          <label style={{ display: "block", marginBottom: 28 }}>
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
            {submitting ? "생성 중…" : "● 녹음 시작하기 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
