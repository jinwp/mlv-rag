"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { AskHistoryMessage, AskMode, AskResponse, AskSource } from "@/lib/types";

type UserMsg = { role: "user"; text: string };
type AssistantMsg = {
  role: "assistant";
  answer: string;
  sources: AskSource[];
  sourcesOpen: boolean;
  loading?: boolean;
  mode?: AskMode;
  model?: string | null;
  needsApiKey?: boolean;
  demoMode?: boolean;
  schemaMissing?: boolean;
  memoryError?: string;
  webSearchEnabled?: boolean;
  webSearchUsed?: boolean;
};
type Msg = UserMsg | AssistantMsg;

type AskApiResponse = AskResponse & {
  error?: string;
};

type ChatSessionRow = {
  id: string;
  title: string | null;
  mode: AskMode | null;
  created_at: string | null;
  updated_at: string | null;
};

type ChatMessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | string;
  content: string;
  mode?: AskMode | null;
  sources?: unknown;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

const MODE_OPTIONS: { key: AskMode; label: string }[] = [
  { key: "rag", label: "RAG" },
  { key: "web", label: "웹 검색" },
  { key: "plain", label: "Plain" },
];

function modeLabel(mode?: AskMode | null): string {
  return MODE_OPTIONS.find((option) => option.key === mode)?.label ?? "RAG";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatDate(value?: string | null): string {
  if (!value) return "no date";
  return new Date(value).toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSources(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as unknown as AskSource[];
}

const mdComponents = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p style={{ margin: "0 0 12px" }} {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      style={{
        margin: "0 0 12px",
        paddingLeft: 18,
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
      {...props}
    />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li style={{ lineHeight: 1.6 }} {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong style={{ fontWeight: 700, color: "#1b2231" }} {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const href = props.href ?? "";
    const isSourceLink = href.startsWith("#ask-source-");
    return (
      <a
        {...props}
        onClick={(event) => {
          if (!isSourceLink) return;
          event.preventDefault();
          document
            .getElementById(href.slice(1))
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }}
        style={
          isSourceLink
            ? {
                display: "inline-flex",
                alignItems: "center",
                border: "1px solid #c8d2f5",
                borderRadius: 6,
                background: "#eef1fc",
                color: "#3550c7",
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 6px",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }
            : { color: "#3550c7", fontWeight: 600, textDecoration: "none" }
        }
      />
    );
  },
};

function askSourceId(messageIndex: number, sourceIndex: number): string {
  return `ask-source-${messageIndex}-${sourceIndex + 1}`;
}

function markdownWithSourceLinks(text: string, messageIndex: number): string {
  return text
    .replace(/\\\*/g, "*")
    .replace(/(근거|웹)\s+(\d+)/g, (_match, prefix: string, sourceNumber: string) => {
      const index = Number(sourceNumber) - 1;
      if (!Number.isFinite(index) || index < 0) return `${prefix} ${sourceNumber}`;
      return `[${prefix} ${sourceNumber}](#${askSourceId(messageIndex, index)})`;
    });
}

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<AskMode>("rag");
  const [chatId, setChatId] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSessionRow[]>([]);
  const [recentChatsOpen, setRecentChatsOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState("");
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    void loadRecentChats();
  }, []);

  async function loadRecentChats() {
    setRecentLoading(true);
    setRecentError("");

    if (!isSupabaseConfigured) {
      setRecentChats([]);
      setRecentError("Supabase env vars are missing.");
      setRecentLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id,title,mode,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(20)
        .returns<ChatSessionRow[]>();

      if (error) throw error;
      setRecentChats(data ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load recent chats.";
      setRecentError(message);
      setRecentChats([]);
    } finally {
      setRecentLoading(false);
    }
  }

  async function loadChatSession(session: ChatSessionRow) {
    if (!isSupabaseConfigured) return;

    setLoadingSessionId(session.id);
    setRecentError("");

    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,chat_id,role,content,mode,sources,metadata,created_at")
        .eq("chat_id", session.id)
        .order("created_at", { ascending: true })
        .returns<ChatMessageRow[]>();

      if (error) throw error;

      const rows = data ?? [];
      const loadedMessages = rows.reduce<Msg[]>((items, row) => {
        if (row.role === "user") {
          items.push({ role: "user", text: row.content });
        } else if (row.role === "assistant") {
          items.push({
            role: "assistant",
            answer: row.content,
            sources: normalizeSources(row.sources),
            sourcesOpen: false,
            mode: row.mode ?? session.mode ?? "rag",
          });
        }
        return items;
      }, []);

      setChatId(session.id);
      setMode(session.mode ?? "rag");
      setDraft("");
      setMessages(loadedMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load chat messages.";
      setRecentError(message);
    } finally {
      setLoadingSessionId(null);
    }
  }

  function startNewChat() {
    setMessages([]);
    setDraft("");
    setChatId(null);
    setMode("rag");
    setRecentChatsOpen(true);
    void loadRecentChats();
  }

  async function send(q?: string) {
    const text = (q ?? draft).trim();
    if (!text) return;
    const requestMode = mode;
    const requestChatId = chatId;
    const history = messages.reduce<AskHistoryMessage[]>((items, message) => {
      if (message.role === "user") {
        items.push({ role: "user", content: message.text });
      } else if (!message.loading) {
        items.push({ role: "assistant", content: message.answer });
      }
      return items;
    }, []);

    setDraft("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", answer: "", sources: [], sourcesOpen: true, loading: true, mode: requestMode },
    ]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, mode: requestMode, history, chatId: requestChatId }),
      });
      const data: AskApiResponse = await res.json();
      if (data.chat_id) setChatId(data.chat_id);
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i];
          if (m.role === "assistant" && m.loading) {
            next[i] = {
              role: "assistant",
              answer:
                !res.ok && data.error
                  ? `${data.answer ?? "답변을 가져오지 못했습니다."}\n\n_${data.error}_`
                  : data.answer ?? "",
              sources: data.sources ?? [],
              sourcesOpen: true,
              mode: data.mode ?? requestMode,
              model: data.model,
              needsApiKey: data.needs_api_key,
              demoMode: data.demo_mode,
              schemaMissing: data.schema_missing,
              memoryError: data.memory_error,
              webSearchEnabled: data.web_search_enabled,
              webSearchUsed: data.web_search_used,
            };
            break;
          }
        }
        return next;
      });
      void loadRecentChats();
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
        flexDirection: "column",
        gap: 9,
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {MODE_OPTIONS.map((option) => {
          const active = option.key === mode;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setMode(option.key)}
              className="mono"
              style={{
                height: 30,
                border: `1px solid ${active ? "#c8d2f5" : "#e1e6ee"}`,
                borderRadius: 8,
                background: active ? "#eef1fc" : "#fff",
                color: active ? "#3550c7" : "#6b7482",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", gap: 8 }}>
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
            padding: variant === "hero" ? "5px 0 7px" : "4px 0 6px",
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
    </div>
  );

  const recentChatList = (
    <>
      <button
        type="button"
        onClick={() => setRecentChatsOpen(true)}
        className="mono"
        style={{
          position: "fixed",
          right: 24,
          top: 72,
          zIndex: 30,
          border: "1px solid #d8dee7",
          background: "#fff",
          color: "#3550c7",
          borderRadius: 999,
          padding: "9px 13px",
          fontSize: 11.5,
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(20,30,50,.10)",
        }}
      >
        Recent chats
        {recentChats.length ? ` · ${recentChats.length}` : ""}
      </button>

      {recentChatsOpen && (
        <>
          <button
            type="button"
            aria-label="Close recent chats"
            onClick={() => setRecentChatsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 39,
              border: "none",
              background: "rgba(15,23,42,.18)",
              cursor: "default",
            }}
          />

          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(420px, calc(100vw - 36px))",
              zIndex: 40,
              background: "#fff",
              borderLeft: "1px solid #e4e8ef",
              boxShadow: "-12px 0 28px rgba(15,23,42,.16)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "18px 18px 14px",
                borderBottom: "1px solid #eceff4",
                background: "#fafbfd",
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "#aab2c0",
                    letterSpacing: ".05em",
                    marginBottom: 4,
                  }}
                >
                  RECENT CHATS
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#1b2231" }}>
                  저장된 채팅
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void loadRecentChats()}
                  className="mono"
                  style={{
                    border: "1px solid #d8dee7",
                    background: "#fff",
                    color: "#3550c7",
                    borderRadius: 8,
                    padding: "6px 9px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  refresh
                </button>
                <button
                  type="button"
                  onClick={() => setRecentChatsOpen(false)}
                  aria-label="Close recent chats"
                  style={{
                    border: "1px solid #d8dee7",
                    background: "#fff",
                    color: "#64748b",
                    borderRadius: 8,
                    width: 30,
                    height: 30,
                    fontSize: 18,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {recentError && (
                <div
                  style={{
                    border: "1px solid #fed7aa",
                    background: "#fff7ed",
                    color: "#9a3412",
                    borderRadius: 10,
                    padding: "11px 13px",
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  {recentError}
                </div>
              )}

              {recentLoading ? (
                <div className="mono" style={{ padding: 14, color: "#9aa3b2", fontSize: 12 }}>
                  loading recent chats...
                </div>
              ) : recentChats.length === 0 ? (
                <div
                  style={{
                    border: "1px dashed #d5dce6",
                    borderRadius: 10,
                    padding: "18px 15px",
                    color: "#94a3b8",
                    fontSize: 13,
                    textAlign: "center",
                    lineHeight: 1.55,
                  }}
                >
                  저장된 채팅이 없습니다. 새 질문을 보내면 여기에 표시됩니다.
                </div>
              ) : (
                recentChats.map((session) => {
                  const active = chatId === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={async () => {
                        await loadChatSession(session);
                        setRecentChatsOpen(false);
                      }}
                      disabled={loadingSessionId === session.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 12,
                        alignItems: "center",
                        textAlign: "left",
                        border: `1px solid ${active ? "#c8d2f5" : "#e4e8ef"}`,
                        background: active ? "#f5f7ff" : "#fff",
                        borderRadius: 10,
                        padding: "12px 14px",
                        cursor: loadingSessionId === session.id ? "default" : "pointer",
                        opacity: loadingSessionId === session.id ? 0.65 : 1,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            color: "#1f2937",
                            fontSize: 14,
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginBottom: 4,
                          }}
                        >
                          {session.title || "Untitled chat"}
                        </span>
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            color: "#94a3b8",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          chat_{shortId(session.id)} · {formatDate(session.updated_at ?? session.created_at)}
                        </span>
                      </span>
                      <span
                        className="mono"
                        style={{
                          flex: "none",
                          border: "1px solid #dde3f7",
                          background: "#eef1fc",
                          color: "#3550c7",
                          borderRadius: 6,
                          padding: "3px 7px",
                          fontSize: 10.5,
                          fontWeight: 700,
                        }}
                      >
                        {loadingSessionId === session.id ? "loading" : modeLabel(session.mode)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {recentChatList}
      {!hasMessages ? (
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
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              flex: "none",
              borderBottom: "1px solid #e4e8ef",
              background: "#fbfcfe",
              padding: "10px 24px",
            }}
          >
            <div
              style={{
                maxWidth: 760,
                margin: "0 auto",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div className="mono" style={{ fontSize: 11, color: "#94a3b8" }}>
                {chatId ? `chat_${shortId(chatId)}` : "unsaved chat"}
              </div>
              <button
                type="button"
                onClick={startNewChat}
                style={{
                  border: "1px solid #d8dee7",
                  background: "#fff",
                  color: "#3550c7",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                새 채팅 / 최근 채팅 보기
              </button>
            </div>
          </div>

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
                      {chatId && (
                        <span className="mono" style={{ fontSize: 11, color: "#b0b8c5" }}>
                          chat_{chatId.slice(0, 6)}
                        </span>
                      )}
                      {!m.loading && (
                        <span className="mono" style={{ fontSize: 11, color: "#aab2c0" }}>
                          {m.needsApiKey
                            ? "OPENAI_API_KEY 필요"
                            : [
                                modeLabel(m.mode),
                                m.model,
                                m.demoMode ? (m.schemaMissing ? "demo memory" : "demo") : null,
                                m.webSearchEnabled ? (m.webSearchUsed ? "웹 검색 사용" : "웹 검색 허용") : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                      )}
                    </div>

                    {m.loading ? (
                      <div className="mono" style={{ fontSize: 13, color: "#9aa3b2" }}>
                        검색 중…
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 14.5, lineHeight: 1.68, color: "#25303f" }}>
                          <ReactMarkdown components={mdComponents}>{markdownWithSourceLinks(m.answer, i)}</ReactMarkdown>
                        </div>
                        {m.memoryError && m.demoMode && (
                          <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: "#8a6a23" }}>
                            {m.memoryError}
                          </div>
                        )}

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
                                {m.sources.map((s, si) => {
                                  const label = s.label ?? `근거 ${si + 1}`;
                                  const isWeb = s.type === "web";
                                  return (
                                    <div
                                      key={si}
                                      id={askSourceId(i, si)}
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
                                            height: 20,
                                            borderRadius: 5,
                                            background: "#3550c7",
                                            color: "#fff",
                                            fontSize: 11,
                                            fontWeight: 600,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: isWeb ? "0 6px" : 0,
                                            width: isWeb ? "auto" : 20,
                                          }}
                                        >
                                          {label.replace("근거 ", "")}
                                        </span>
                                        <span style={{ fontWeight: 600, fontSize: 13.5, color: "#1b2231" }}>
                                          {isWeb ? s.title ?? "웹 출처" : s.title ?? "회의 근거"}
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
                                          {isWeb ? s.url ?? s.text : `"${s.text}"`}
                                        </div>
                                      </div>
                                      {isWeb && s.url ? (
                                        <a
                                          href={s.url}
                                          target="_blank"
                                          rel="noreferrer"
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
                                          웹 출처 열기 →
                                        </a>
                                      ) : s.meeting_id ? (
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
                                  );
                                })}
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
