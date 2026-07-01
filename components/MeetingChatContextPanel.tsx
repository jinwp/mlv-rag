"use client";

import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { AskMode, ChatSession } from "@/lib/types";

type Props = {
  meetingId: string;
};

type SelectionRow = {
  chat_id: string;
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function modeLabel(mode?: AskMode | null): string {
  if (mode === "web") return "웹 검색";
  if (mode === "plain") return "Plain";
  return "RAG";
}

function formatDate(value?: string | null): string {
  if (!value) return "no date";
  return new Date(value).toLocaleString();
}

function isMissingChatSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes("chat_sessions") || lower.includes("meeting_chat_context_selections")) &&
    (lower.includes("could not find the table") ||
      lower.includes("schema cache") ||
      lower.includes("pgrst205"))
  );
}

export function MeetingChatContextPanel({ meetingId }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    const selected = [...selectedIds].sort().join(",");
    const saved = [...savedIds].sort().join(",");
    return selected !== saved;
  }, [selectedIds, savedIds]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);
      setStatus(null);

      if (!isSupabaseConfigured) {
        setLoading(false);
        setError("Supabase env vars are missing.");
        return;
      }

      try {
        const [sessionResult, selectionResult] = await Promise.all([
          supabase
            .from("chat_sessions")
            .select("id,title,mode,created_at,updated_at")
            .order("updated_at", { ascending: false })
            .limit(50)
            .returns<ChatSession[]>(),
          supabase
            .from("meeting_chat_context_selections")
            .select("chat_id")
            .eq("meeting_id", meetingId)
            .returns<SelectionRow[]>(),
        ]);

        if (sessionResult.error) throw sessionResult.error;
        if (selectionResult.error) throw selectionResult.error;

        const ids = (selectionResult.data ?? []).map((row) => row.chat_id);

        if (alive) {
          setSessions(sessionResult.data ?? []);
          setSelectedIds(ids);
          setSavedIds(ids);
        }
      } catch (err: any) {
        if (alive) {
          const message = err?.message ?? "Failed to load chat context selections.";
          setError(
            isMissingChatSchemaError(message)
              ? "Chat context tables are not applied yet. Run supabase-rag-schema.sql, then reload this page."
              : message
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [meetingId]);

  function toggle(id: string) {
    setStatus(null);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const { error: deleteError } = await supabase
        .from("meeting_chat_context_selections")
        .delete()
        .eq("meeting_id", meetingId);

      if (deleteError) throw deleteError;

      if (selectedIds.length > 0) {
        const { error: insertError } = await supabase
          .from("meeting_chat_context_selections")
          .insert(
            selectedIds.map((chatId) => ({
              meeting_id: meetingId,
              chat_id: chatId,
            }))
          );

        if (insertError) throw insertError;
      }

      setSavedIds(selectedIds);
      setStatus("저장됨");
    } catch (err: any) {
      setError(err?.message ?? "Failed to save chat context selections.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontWeight: 800 }}>채팅 context</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            meeting summary context candidates
          </div>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: "#aab2c0" }}>
          {selectedIds.length} SELECTED
        </span>
      </div>

      <div style={{ padding: 18, display: "grid", gap: 13 }}>
        {error && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fff7ed",
              color: "#9a3412",
              border: "1px solid #fed7aa",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="mono" style={{ fontSize: 12, color: "#94a3b8" }}>
            loading chats...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13 }}>
            저장된 채팅이 없습니다.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sessions.map((session) => {
              const checked = selectedIds.includes(session.id);

              return (
                <label
                  key={session.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: 11,
                    padding: "11px 12px",
                    border: `1px solid ${checked ? "#c8d2f5" : "#eef2f7"}`,
                    borderRadius: 10,
                    background: checked ? "#f5f7ff" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(session.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 5,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: "#1f2937",
                        }}
                      >
                        {session.title || "Untitled chat"}
                      </span>
                      <span className="mono" style={{ flex: "none", fontSize: 10.5, color: "#3550c7" }}>
                        {modeLabel(session.mode)}
                      </span>
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
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span className="mono" style={{ fontSize: 11, color: status ? "#16a34a" : "#94a3b8" }}>
            {status ?? (hasChanges ? "unsaved changes" : "ready")}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving || !hasChanges}
            style={{
              ...(hasChanges ? primaryButton : button),
              opacity: loading || saving || !hasChanges ? 0.55 : 1,
              cursor: loading || saving || !hasChanges ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save context"}
          </button>
        </div>
      </div>
    </section>
  );
}
