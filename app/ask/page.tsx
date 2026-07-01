"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AskResponse, AskSource } from "@/lib/types";

type UserMsg = { role: "user"; text: string };
type AssistantMsg = {
  role: "assistant";
  answer: string;
  sources: AskSource[];
  sourcesOpen: boolean;
  loading?: boolean;
};
type Msg = UserMsg | AssistantMsg;

const EXAMPLES = [
  "GSM8K 대신 TFQA-MC를 쓰기로 한 이유가 뭐였지?",
  "지난달 로봇팔 실험에서 뭘 결정했지?",
  "SBQ 논문 camera-ready 관련 TODO가 뭐였지?",
];

const mdComponents = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p style={{ margin: "0 0 12px" }} {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul style={{ margin: "0 0 12px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }} {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li style={{ lineHeight: 1.6 }} {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong style={{ fontWeight: 700, color: "#1b2231" }} {...props} />
  ),
};

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  async function send(q?: string) {
    const text = (q ?? draft).trim();
    if (!text) return;
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", answer: "", sources: [], sourcesOpen: true, loading: true },
    ]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data: AskResponse = await res.json();
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i];
          if (m.role === "assistant" && m.loading) {
            next[i] = {
              role: "assistant",
              answer: data.answer ?? "",
              sources: data.sources ?? [],
              sourcesOpen: true,
            };
            break;
          }
        }
        return next;
      });
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i];
          if (m.role === "assistant" && m.loading) {
            next[i] = {
              role: "assistant",
              answer: "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
              sources: [],
              sourcesOpen: false,
            };
            break;
          }
        }
        return next;
      });
    }
  }

  function toggleSources(idx: number) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === idx && m.role === "assistant" ? { ...m, sourcesOpen: !m.sourcesOpen } : m
      )
    );
  }

  const composer = (variant: "hero" | "bottom") => (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        background: "#fff",
        border: "1px solid #d8dee7",
        borderRadius: 14,
        padding: variant === "hero" ? "8px 8px 8px 16px" : "6px 6px 6px 16px",
        boxShadow:
          variant === "hero"
            ? "0 2px 10px rgba(20,30,50,.06)"
            : "0 1px 4px rgba(20,30,50,.05)",
        textAlign: "left",
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder={
          variant === "hero"
            ? "예: GSM8K 대신 TFQA-MC를 쓰기로 한 이유가 뭐였지?"
            : "이어서 질문하기…"
        }
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: variant === "hero" ? 15 : 14.5,
          lineHeight: 1.5,
          color: "#1b2231",
          padding: variant === "hero" ? "9px 0" : "8px 0",
          maxHeight: 120,
        }}
      />
      <button
        type="button"
        onClick={() => send()}
        style={{
          flex: "none",
          width: variant === "hero" ? 38 : 36,
          height: variant === "hero" ? 38 : 36,
          border: "none",
          borderRadius: 9,
          background: "#3550c7",
          color: "#fff",
          fontSize: 16,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ↑
      </button>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {!hasMessages ? (
        // ---- HERO (empty) ----
        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 24px 60px",
          }}
        >
          <div style={{ maxWidth: 680, width: "100%", textAlign: "center" }}>
            <div
              className="mono"
              style={{ fontSize: 12, color: "#9aa3b2", letterSpacing: ".06em", marginBottom: 14 }}
            >
              ASK THE ARCHIVE
            </div>
            <h1
              style={{
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: "-.025em",
                margin: "0 0 10px",
                lineHeight: 1.2,
              }}
            >
              지난 회의에게 물어보세요
            </h1>
            <p style={{ margin: "0 0 30px", color: "#6b7482", fontSize: 14.5, lineHeight: 1.6 }}>
              &quot;왜 그렇게 결정했더라?&quot; — 녹음·전사된 모든 회의에서
              <br />
              근거가 되는 발언까지 찾아 인용해 드립니다.
            </p>

            {composer("hero")}

            <div style={{ marginTop: 22, textAlign: "left" }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: "#aab2c0", letterSpacing: ".03em", marginBottom: 10 }}
              >
                EXAMPLES
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      textAlign: "left",
                      border: "1px solid #e4e8ef",
                      background: "#fff",
                      borderRadius: 10,
                      padding: "12px 15px",
                      cursor: "pointer",
                      fontSize: 14,
                      color: "#3a4252",
                      lineHeight: 1.4,
                    }}
                  >
                    <span className="mono" style={{ flex: "none", color: "#c2cad6" }}>
                      ?
                    </span>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        // ---- CHAT (active) ----
        <>
          <div ref={chatRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "30px 24px 20px" }}>
            <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26 }}>
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div
                    key={i}
                    style={{
                      alignSelf: "flex-end",
                      maxWidth: "80%",
                      background: "#3550c7",
                      color: "#fff",
                      borderRadius: "16px 16px 4px 16px",
                      padding: "11px 16px",
                      fontSize: 14.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {m.text}
                  </div>
                ) : (
                  <div key={i} style={{ alignSelf: "stretch", maxWidth: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                      <div
                        className="mono"
                        style={{
                          width: 24,
                          height: 24,
                          flex: "none",
                          borderRadius: 6,
                          background: "#1b2231",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                        }}
                      >
                        ›
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: "#9aa3b2", letterSpacing: ".03em" }}>
                        Lab RAG
                      </span>
                    </div>

                    {m.loading ? (
                      <div className="mono" style={{ fontSize: 13, color: "#9aa3b2" }}>
                        검색 중…
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 14.5, lineHeight: 1.68, color: "#25303f" }}>
                          <ReactMarkdown components={mdComponents}>{m.answer}</ReactMarkdown>
                        </div>

                        {m.sources.length > 0 && (
                          <div
                            style={{
                              marginTop: 6,
                              border: "1px solid #e4e8ef",
                              borderRadius: 12,
                              overflow: "hidden",
                              background: "#fbfcfe",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSources(i)}
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 9,
                                padding: "11px 15px",
                                border: "none",
                                background: "none",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#3a4252",
                              }}
                            >
                              <span
                                className="mono"
                                style={{
                                  fontSize: 11,
                                  color: "#3550c7",
                                  transition: "transform .15s",
                                  transform: m.sourcesOpen ? "rotate(90deg)" : "rotate(0deg)",
                                }}
                              >
                                ▶
                              </span>
                              {m.sourcesOpen ? "출처 접기" : "출처 보기"} ({m.sources.length})
                            </button>
                            {m.sourcesOpen && (
                              <div style={{ padding: "2px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                                {m.sources.map((s, si) => (
                                  <div
                                    key={si}
                                    style={{
                                      border: "1px solid #e4e8ef",
                                      borderRadius: 10,
                                      background: "#fff",
                                      padding: "14px 15px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 9,
                                        marginBottom: 8,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span
                                        className="mono"
                                        style={{
                                          flex: "none",
                                          width: 20,
                                          height: 20,
                                          borderRadius: 5,
                                          background: "#3550c7",
                                          color: "#fff",
                                          fontSize: 11,
                                          fontWeight: 600,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                        }}
                                      >
                                        {si + 1}
                                      </span>
                                      <span style={{ fontWeight: 600, fontSize: 13.5, color: "#1b2231" }}>
                                        인용된 발언
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 13,
                                        lineHeight: 1.55,
                                        color: "#6b7482",
                                        marginBottom: 10,
                                      }}
                                    >
                                      {s.reason}
                                    </div>
                                    <div
                                      style={{
                                        borderLeft: "2px solid #3550c7",
                                        padding: "2px 0 2px 12px",
                                        marginBottom: 11,
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontSize: 13.5,
                                          lineHeight: 1.55,
                                          color: "#25303f",
                                          fontStyle: "italic",
                                        }}
                                      >
                                        &quot;{s.text}&quot;
                                      </div>
                                    </div>
                                    {s.meeting_id ? (
                                      <Link
                                        href={`/meetings/${s.meeting_id}`}
                                        style={{
                                          color: "#3550c7",
                                          fontSize: 13,
                                          fontWeight: 600,
                                          textDecoration: "none",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 5,
                                        }}
                                      >
                                        회의 상세 보기 →
                                      </Link>
                                    ) : (
                                      <span className="mono" style={{ fontSize: 12, color: "#aab2c0" }}>
                                        연결된 회의 없음
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          {/* bottom input */}
          <div
            style={{
              flex: "none",
              borderTop: "1px solid #e4e8ef",
              background: "#f4f6f9",
              padding: "14px 24px 18px",
            }}
          >
            <div style={{ maxWidth: 760, margin: "0 auto" }}>{composer("bottom")}</div>
          </div>
        </>
      )}
    </div>
  );
}
