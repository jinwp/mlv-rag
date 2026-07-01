"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { fmtLog } from "@/lib/format";
import { DUMMY_MEETINGS } from "@/lib/rag/fixtures";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import {
  MEMORY_KINDS,
  type MemoryChunkInput,
  type MemoryChunkRow,
  type MemoryKind,
  type RagChatMessage,
  type RagChatResponse,
  type MemorySearchResult,
} from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { Meeting } from "@/lib/types";

type IndexResponse = {
  meeting_id?: string;
  dry_run?: boolean;
  generated_by?: string;
  count?: number;
  chunks?: MemoryChunkInput[];
  error?: string;
  details?: unknown;
};

type SearchResponse = {
  question?: string;
  count?: number;
  results?: MemorySearchResult[];
  error?: string;
  details?: unknown;
};

type ChatResponse = RagChatResponse & {
  error?: string;
  details?: unknown;
};

type LoadState = "idle" | "loading" | "done" | "error";

type PreviewItem = MemoryChunkInput & {
  id: string;
  score?: number;
  score_breakdown?: MemorySearchResult["score_breakdown"];
  matched_terms?: string[];
};

type ChatItem = RagChatMessage & {
  model?: string | null;
  sources?: MemorySearchResult[];
  needs_api_key?: boolean;
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e8ef",
  borderRadius: 13,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
};

const panelHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 15px",
  borderBottom: "1px solid #eceff4",
  background: "#fafbfd",
};

const buttonBase: React.CSSProperties = {
  border: "1px solid #d8dee7",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const inputBase: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d8dee7",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13.5,
  color: "#1b2231",
  outline: "none",
  background: "#fbfcfe",
};

const kindLabel: Record<MemoryKind, string> = {
  meeting_meta: "meta",
  raw_transcript: "transcript",
  note: "note",
  board_capture: "board",
  decision: "decision",
  todo: "todo",
  open_question: "question",
  summary: "summary",
};

const mdComponents = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p style={{ margin: "0 0 10px" }} {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul style={{ margin: "0 0 10px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }} {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => <li style={{ lineHeight: 1.55 }} {...props} />,
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong style={{ fontWeight: 700, color: "#1b2231" }} {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const href = props.href ?? "";
    const isSourceLink = href.startsWith("#rag-source-");
    return (
      <a
        {...props}
        onClick={(event) => {
          if (!isSourceLink) return;
          event.preventDefault();
          document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

function detailText(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function timeRange(start?: number | null, end?: number | null): string {
  if (start === null || start === undefined) return "no timestamp";
  if (end !== null && end !== undefined && end !== start) return `${fmtLog(start)}-${fmtLog(end)}`;
  return fmtLog(start);
}

function trimId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function domSafeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function ragSourceId(messageId: string, sourceIndex: number): string {
  return `rag-source-${domSafeId(messageId)}-${sourceIndex + 1}`;
}

function markdownWithSourceLinks(text: string, messageId: string): string {
  return text
    .replace(/\\\*/g, "*")
    .replace(/근거\s+(\d+)/g, (_match, sourceNumber: string) => {
      const index = Number(sourceNumber) - 1;
      if (!Number.isFinite(index) || index < 0) return `근거 ${sourceNumber}`;
      return `[근거 ${sourceNumber}](#${ragSourceId(messageId, index)})`;
    });
}

function makeClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function RagPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingState, setMeetingState] = useState<LoadState>("idle");
  const [meetingError, setMeetingError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<MemoryChunkInput[]>([]);
  const [indexState, setIndexState] = useState<LoadState>("idle");
  const [indexMessage, setIndexMessage] = useState("");
  const [question, setQuestion] = useState("왜 GSM8K 우선순위를 낮췄지?");
  const [limit, setLimit] = useState(8);
  const [projectOnly, setProjectOnly] = useState(false);
  const [searchSortBySimilarity, setSearchSortBySimilarity] = useState(true);
  const [previewSortBySimilarity, setPreviewSortBySimilarity] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<MemoryKind[]>([]);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [chatId, setChatId] = useState("");
  const [chatState, setChatState] = useState<LoadState>("idle");
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([]);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedId) ?? null,
    [meetings, selectedId]
  );

  const previewItems = useMemo<PreviewItem[]>(() => {
    const rows: MemoryChunkRow[] = preview.map((chunk, index) => ({
      ...chunk,
      id: `preview-${chunk.source_type}-${chunk.source_id ?? "meta"}-${chunk.chunk_index}-${index}`,
      meetings: selectedMeeting
        ? {
            title: selectedMeeting.title,
            date: selectedMeeting.date,
            project_tag: selectedMeeting.project_tag,
          }
        : null,
    }));

    if (!previewSortBySimilarity || !question.trim()) return rows;

    return rankMemoryChunks(question, rows, {
      limit: Math.max(rows.length, 1),
      includeZero: true,
      sortBySimilarity: true,
    });
  }, [preview, previewSortBySimilarity, question, selectedMeeting]);

  async function loadMeetings() {
    setMeetingState("loading");
    setMeetingError("");

    if (!isSupabaseConfigured) {
      setMeetings(DUMMY_MEETINGS);
      setSelectedId((current) => current || DUMMY_MEETINGS[0]?.id || "");
      setMeetingState("done");
      return;
    }

    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<Meeting[]>();

    if (error) {
      setMeetings([]);
      setMeetingState("error");
      setMeetingError(error.message);
      return;
    }

    const rows = data ?? [];
    setMeetings(rows);
    setSelectedId((current) => current || rows[0]?.id || "");
    setMeetingState("done");
  }

  useEffect(() => {
    loadMeetings();
  }, []);

  useEffect(() => {
    setChatId((current) => current || makeClientId("chat"));
  }, []);

  async function indexMeeting(dryRun: boolean) {
    if (!selectedId) return;
    setIndexState("loading");
    setIndexMessage("");
    if (dryRun) setPreview([]);

    try {
      const res = await fetch("/api/rag/index-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: selectedId, dryRun }),
      });
      const data: IndexResponse = await res.json();
      if (!res.ok || data.error) {
        setIndexState("error");
        setIndexMessage(`${data.error ?? "index failed"} ${detailText(data.details)}`.trim());
        return;
      }

      if (dryRun) {
        setPreview(data.chunks ?? []);
        setIndexMessage(`${data.count ?? 0} chunks previewed`);
      } else {
        setIndexMessage(`${data.count ?? 0} chunks indexed`);
      }
      setIndexState("done");
    } catch (err) {
      setIndexState("error");
      setIndexMessage(err instanceof Error ? err.message : "index request failed");
    }
  }

  async function search() {
    const text = question.trim();
    if (!text) return;
    setSearchState("loading");
    setSearchMessage("");
    setResults([]);

    try {
      const res = await fetch("/api/rag/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          limit,
          projectTag: projectOnly ? selectedMeeting?.project_tag ?? undefined : undefined,
          kinds: selectedKinds.length ? selectedKinds : undefined,
          sortBySimilarity: searchSortBySimilarity,
        }),
      });
      const data: SearchResponse = await res.json();
      if (!res.ok || data.error) {
        setSearchState("error");
        setSearchMessage(`${data.error ?? "search failed"} ${detailText(data.details)}`.trim());
        return;
      }

      setResults(data.results ?? []);
      setSearchMessage(`${data.count ?? 0} results`);
      setSearchState("done");
    } catch (err) {
      setSearchState("error");
      setSearchMessage(err instanceof Error ? err.message : "search request failed");
    }
  }

  async function askLlm() {
    const text = question.trim();
    if (!text) return;

    const userMessage: ChatItem = {
      id: makeClientId("user"),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const nextHistory = [...chatMessages, userMessage].slice(-10);

    setChatMessages(nextHistory);
    setChatState("loading");
    setChatMessage("");

    try {
      const res = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          limit,
          projectTag: projectOnly ? selectedMeeting?.project_tag ?? undefined : undefined,
          kinds: selectedKinds.length ? selectedKinds : undefined,
          sortBySimilarity: searchSortBySimilarity,
          chatId: chatId || undefined,
          messageId: userMessage.id,
          history: nextHistory,
        }),
      });
      const data: ChatResponse = await res.json();
      if (data.chatId) setChatId(data.chatId);
      if (data.sources) {
        setResults(data.sources);
        setSearchMessage(`${data.sources.length} evidence chunks`);
        setSearchState("done");
      }

      const assistantMessage: ChatItem | null = data.answer
        ? {
            id: data.assistantMessageId || makeClientId("assistant"),
            role: "assistant",
            content: data.answer,
            createdAt: new Date().toISOString(),
            model: data.model,
            sources: data.sources,
            needs_api_key: data.needs_api_key,
          }
        : null;

      if (!res.ok || data.error) {
        setChatState("error");
        setChatMessage(`${data.error ?? "LLM answer failed"} ${detailText(data.details)}`.trim());
        if (assistantMessage) setChatMessages((current) => [...current, assistantMessage]);
        return;
      }

      if (assistantMessage) setChatMessages((current) => [...current, assistantMessage]);
      setChatMessage(
        data.needs_api_key
          ? "OPENAI_API_KEY 필요"
          : `${data.model ?? "local"} · ${(data.sources ?? []).length} sources`
      );
      setChatState("done");
    } catch (err) {
      setChatState("error");
      setChatMessage(err instanceof Error ? err.message : "LLM answer request failed");
    }
  }

  function toggleKind(kind: MemoryKind) {
    setSelectedKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
    );
  }

  const retrievalStatus =
    chatState === "loading"
      ? "answering..."
      : searchState === "loading"
        ? "searching..."
        : chatMessage || searchMessage || "ready";
  const retrievalStatusColor = chatState === "error" || searchState === "error" ? "#c0323a" : "#8a93a3";

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: "28px 28px 70px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "#8a93a3", letterSpacing: ".04em", marginBottom: 6 }}>
              MEMORY INDEX
            </div>
            <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-.02em", margin: 0 }}>
              RAG 실험
            </h1>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "#9aa3b2" }}>
            {isSupabaseConfigured ? "supabase" : "dummy"} · {meetings.length} meetings · {preview.length} preview chunks
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={panel}>
              <div style={panelHead}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#303949" }}>회의 선택</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "#aab2c0", marginTop: 2 }}>
                    SOURCE
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadMeetings}
                  disabled={meetingState === "loading"}
                  style={{ ...buttonBase, background: "#fff", color: "#3550c7" }}
                >
                  ↻
                </button>
              </div>

              <div style={{ maxHeight: 360, overflow: "auto", padding: 10 }}>
                {meetingState === "loading" && (
                  <div className="mono" style={{ padding: 18, color: "#9aa3b2", fontSize: 12 }}>
                    loading...
                  </div>
                )}
                {meetingState === "error" && (
                  <div style={{ padding: 12, color: "#c0323a", fontSize: 13, lineHeight: 1.55 }}>
                    {meetingError || "회의를 불러오지 못했습니다."}
                  </div>
                )}
                {meetingState !== "loading" && meetings.length === 0 && (
                  <div style={{ padding: 18, color: "#9aa3b2", fontSize: 13, textAlign: "center" }}>
                    회의 없음
                  </div>
                )}
                {meetings.map((meeting) => {
                  const active = meeting.id === selectedId;
                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(meeting.id);
                        setPreview([]);
                      }}
                      style={{
                        width: "100%",
                        border: active ? "1px solid #c8d2f5" : "1px solid transparent",
                        background: active ? "#f1f4ff" : "#fff",
                        borderRadius: 9,
                        padding: "10px 11px",
                        cursor: "pointer",
                        textAlign: "left",
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 650,
                          color: "#1b2231",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {meeting.title}
                      </div>
                      <div
                        className="mono"
                        style={{
                          display: "flex",
                          gap: 8,
                          marginTop: 4,
                          color: "#8a93a3",
                          fontSize: 10.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>{meeting.date ?? "no-date"}</span>
                        <span>·</span>
                        <span>{meeting.project_tag ?? "미분류"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section style={panel}>
              <div style={panelHead}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#303949" }}>색인</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "#aab2c0", marginTop: 2 }}>
                    CHUNKER
                  </div>
                </div>
                {selectedMeeting && (
                  <Link
                    href={`/meetings/${selectedMeeting.id}`}
                    style={{ color: "#3550c7", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}
                  >
                    상세 →
                  </Link>
                )}
              </div>

              <div style={{ padding: 15 }}>
                {selectedMeeting ? (
                  <>
                    <div style={{ marginBottom: 13 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1b2231", lineHeight: 1.35 }}>
                        {selectedMeeting.title}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "#8a93a3", marginTop: 5 }}>
                        {trimId(selectedMeeting.id)} · {selectedMeeting.project_tag ?? "미분류"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => indexMeeting(true)}
                        disabled={indexState === "loading"}
                        style={{ ...buttonBase, flex: 1, background: "#fff", color: "#3550c7" }}
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => indexMeeting(false)}
                        disabled={indexState === "loading"}
                        style={{
                          ...buttonBase,
                          flex: 1,
                          borderColor: "#1b2231",
                          background: "#1b2231",
                          color: "#fff",
                        }}
                      >
                        Index
                      </button>
                    </div>
                    {indexMessage && (
                      <div
                        style={{
                          marginTop: 12,
                          borderRadius: 8,
                          padding: "9px 10px",
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          color: indexState === "error" ? "#c0323a" : "#436053",
                          background: indexState === "error" ? "#fdecec" : "#edf8f1",
                          border: `1px solid ${indexState === "error" ? "#f3caca" : "#cdebd9"}`,
                        }}
                      >
                        {indexMessage}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: "#9aa3b2", fontSize: 13, textAlign: "center", padding: 18 }}>
                    선택된 회의 없음
                  </div>
                )}
              </div>
            </section>
          </div>

          <section style={panel}>
            <div style={panelHead}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#303949" }}>검색</div>
                <div className="mono" style={{ fontSize: 10.5, color: "#aab2c0", marginTop: 2 }}>
                  RETRIEVAL
                </div>
              </div>
              <div className="mono" style={{ fontSize: 11, color: retrievalStatusColor }}>
                {retrievalStatus}
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10, alignItems: "start" }}>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      search();
                    }
                  }}
                  rows={3}
                  placeholder="검색 질문"
                  style={{ ...inputBase, lineHeight: 1.55, minHeight: 86 }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 8)))}
                    className="mono"
                    style={{ ...inputBase, height: 38, textAlign: "center" }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button
                      type="button"
                      onClick={search}
                      disabled={searchState === "loading"}
                      style={{
                        ...buttonBase,
                        height: 40,
                        borderColor: "#3550c7",
                        background: "#3550c7",
                        color: "#fff",
                        padding: 0,
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={askLlm}
                      disabled={chatState === "loading"}
                      className="mono"
                      style={{
                        ...buttonBase,
                        height: 40,
                        borderColor: "#1b2231",
                        background: "#1b2231",
                        color: "#fff",
                        padding: 0,
                      }}
                    >
                      AI
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setProjectOnly((v) => !v)}
                  disabled={!selectedMeeting?.project_tag}
                  className="mono"
                  style={{
                    border: `1px solid ${projectOnly ? "#c8d2f5" : "#dfe4ec"}`,
                    background: projectOnly ? "#eef1fc" : "#fff",
                    color: projectOnly ? "#3550c7" : "#6b7482",
                    borderRadius: 20,
                    padding: "5px 10px",
                    fontSize: 11.5,
                    cursor: selectedMeeting?.project_tag ? "pointer" : "not-allowed",
                  }}
                >
                  project
                </button>
                {MEMORY_KINDS.map((kind) => {
                  const active = selectedKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => toggleKind(kind)}
                      className="mono"
                      style={{
                        border: `1px solid ${active ? "#c8d2f5" : "#dfe4ec"}`,
                        background: active ? "#eef1fc" : "#fff",
                        color: active ? "#3550c7" : "#6b7482",
                        borderRadius: 20,
                        padding: "5px 10px",
                        fontSize: 11.5,
                        cursor: "pointer",
                      }}
                    >
                      {kindLabel[kind]}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSearchSortBySimilarity((v) => !v)}
                  className="mono"
                  style={{
                    border: `1px solid ${searchSortBySimilarity ? "#c8d2f5" : "#dfe4ec"}`,
                    background: searchSortBySimilarity ? "#eef1fc" : "#fff",
                    color: searchSortBySimilarity ? "#3550c7" : "#6b7482",
                    borderRadius: 20,
                    padding: "5px 10px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  유사도 정렬
                </button>
              </div>

              <div
                style={{
                  marginTop: 14,
                  border: "1px solid #e9edf4",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#fcfdff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    padding: "9px 11px",
                    borderBottom: "1px solid #edf0f5",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#303949" }}>채팅</span>
                  <span className="mono" style={{ fontSize: 10.5, color: "#8a93a3" }}>
                    {chatId ? trimId(chatId) : "new"} · {chatMessages.length} messages
                  </span>
                </div>
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflow: "auto" }}>
                  {chatMessages.length === 0 && (
                    <div style={{ color: "#9aa3b2", fontSize: 12.5, padding: "10px 2px" }}>
                      대기 중
                    </div>
                  )}
                  {chatMessages.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <div
                        key={message.id}
                        style={{
                          alignSelf: isUser ? "flex-end" : "stretch",
                          maxWidth: isUser ? "84%" : "100%",
                          border: "1px solid #e4e8ef",
                          borderRadius: 9,
                          background: isUser ? "#eef1fc" : "#fff",
                          padding: "10px 11px",
                        }}
                      >
                        <div
                          className="mono"
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            color: "#8a93a3",
                            fontSize: 10.5,
                            marginBottom: 6,
                          }}
                        >
                          <span>{message.role}</span>
                          <span>{trimId(message.id)}</span>
                        </div>
                        <div style={{ fontSize: 13.2, lineHeight: 1.58, color: "#25303f" }}>
                          {isUser ? (
                            message.content
                          ) : (
                            <ReactMarkdown components={mdComponents}>
                              {markdownWithSourceLinks(message.content, message.id)}
                            </ReactMarkdown>
                          )}
                        </div>
                        {message.role === "assistant" && (
                          <>
                            <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: "#8a93a3" }}>
                              {message.needs_api_key ? "server env required" : message.model ?? "local"} ·{" "}
                              {message.sources?.length ?? 0} sources
                            </div>
                            {message.sources && message.sources.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
                                {message.sources.map((source, index) => (
                                  <div
                                    key={source.id}
                                    id={ragSourceId(message.id, index)}
                                    style={{
                                      border: "1px solid #edf0f5",
                                      borderRadius: 8,
                                      padding: "7px 8px",
                                      background: "#fbfcfe",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 7,
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <span
                                        className="mono"
                                        style={{
                                          background: "#eef1fc",
                                          color: "#3550c7",
                                          border: "1px solid #dde3f7",
                                          borderRadius: 6,
                                          padding: "2px 6px",
                                          fontSize: 10.5,
                                          fontWeight: 700,
                                        }}
                                      >
                                        근거 {index + 1}
                                      </span>
                                      <span style={{ fontSize: 12.2, fontWeight: 650, color: "#303949" }}>
                                        {source.meeting_title ?? source.meeting_id}
                                      </span>
                                      <span className="mono" style={{ fontSize: 10.5, color: "#9aa3b2" }}>
                                        {timeRange(source.start_seconds, source.end_seconds)}
                                      </span>
                                    </div>
                                    <div style={{ marginTop: 5, fontSize: 12.2, lineHeight: 1.45, color: "#6b7482" }}>
                                      {(source.highlights[0] ?? source.content).slice(0, 150)}
                                    </div>
                                    <Link
                                      href={`/meetings/${source.meeting_id}`}
                                      style={{
                                        display: "inline-flex",
                                        marginTop: 6,
                                        color: "#3550c7",
                                        fontSize: 11.5,
                                        fontWeight: 700,
                                        textDecoration: "none",
                                      }}
                                    >
                                      회의 상세 보기 →
                                    </Link>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 11 }}>
                {results.map((result) => (
                  <div
                    key={result.id}
                    style={{
                      border: "1px solid #e4e8ef",
                      borderRadius: 11,
                      background: "#fff",
                      padding: "13px 14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          background: "#eef1fc",
                          color: "#3550c7",
                          border: "1px solid #dde3f7",
                          borderRadius: 6,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {kindLabel[result.memory_kind]}
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1b2231" }}>
                        {result.meeting_title ?? result.meeting_id}
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: "#9aa3b2" }}>
                        {result.score.toFixed(2)} · {timeRange(result.start_seconds, result.end_seconds)}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#25303f", whiteSpace: "pre-wrap" }}>
                      {(result.highlights.length ? result.highlights : [result.content]).join("\n")}
                    </div>
                    <div
                      className="mono"
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 7,
                        marginTop: 10,
                        color: "#8a93a3",
                        fontSize: 10.5,
                      }}
                    >
                      <span>{result.project_tag ?? "미분류"}</span>
                      <span>{result.source_type}</span>
                      <span>{result.matched_terms.join(", ") || "no lexical term"}</span>
                    </div>
                  </div>
                ))}
                {searchState === "done" && results.length === 0 && (
                  <div style={{ border: "1px dashed #d5dce6", borderRadius: 10, padding: 22, textAlign: "center", color: "#9aa3b2", fontSize: 13 }}>
                    검색 결과 없음
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <section style={{ ...panel, marginTop: 18 }}>
          <div style={panelHead}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#303949" }}>Chunk preview</div>
              <div className="mono" style={{ fontSize: 10.5, color: "#aab2c0", marginTop: 2 }}>
                DRY RUN
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <button
                type="button"
                onClick={() => setPreviewSortBySimilarity((v) => !v)}
                disabled={preview.length === 0}
                className="mono"
                style={{
                  border: `1px solid ${previewSortBySimilarity ? "#c8d2f5" : "#dfe4ec"}`,
                  background: previewSortBySimilarity ? "#eef1fc" : "#fff",
                  color: previewSortBySimilarity ? "#3550c7" : "#6b7482",
                  borderRadius: 20,
                  padding: "5px 10px",
                  fontSize: 11.5,
                  cursor: preview.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                유사도 정렬
              </button>
              <div className="mono" style={{ fontSize: 11, color: "#8a93a3" }}>
                {preview.length}
              </div>
            </div>
          </div>
          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {previewItems.map((chunk) => (
              <div
                key={chunk.id}
                style={{
                  border: "1px solid #e4e8ef",
                  borderRadius: 10,
                  padding: "11px 12px",
                  background: "#fff",
                  minHeight: 138,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "#3550c7" }}>
                    {kindLabel[chunk.memory_kind]} #{chunk.chunk_index}
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: "#9aa3b2" }}>
                    {previewSortBySimilarity && chunk.score !== undefined
                      ? `${chunk.score.toFixed(2)} · ${timeRange(chunk.start_seconds, chunk.end_seconds)}`
                      : timeRange(chunk.start_seconds, chunk.end_seconds)}
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: "#25303f", whiteSpace: "pre-wrap" }}>
                  {chunk.content.length > 280 ? `${chunk.content.slice(0, 280)}...` : chunk.content}
                </div>
                <div className="mono" style={{ marginTop: 9, color: "#9aa3b2", fontSize: 10.5 }}>
                  {previewSortBySimilarity && chunk.matched_terms?.length
                    ? chunk.matched_terms.join(" · ")
                    : (chunk.tags ?? []).join(" · ")}
                </div>
              </div>
            ))}
            {preview.length === 0 && (
              <div
                style={{
                  gridColumn: "1/-1",
                  border: "1px dashed #d5dce6",
                  borderRadius: 10,
                  padding: 26,
                  textAlign: "center",
                  color: "#9aa3b2",
                  fontSize: 13,
                }}
              >
                Preview를 실행하면 chunk가 표시됩니다
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
