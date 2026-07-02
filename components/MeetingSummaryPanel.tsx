"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

type Props = {
  meetingId: string;
  initialSummary?: string | null;
  initialProvider?: string | null;
  initialGeneratedAt?: string | null;
};

type SummaryResponse = {
  provider?: string;
  summary?: string;
  summary_generated_at?: string;
  summary_model?: string;
  rag_indexed?: boolean;
  rag_index_warning?: string;
  transcript_count?: number;
  refined_count?: number;
  error?: string;
  details?: unknown;
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
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  borderRadius: 8,
  padding: "7px 11px",
  cursor: "pointer",
  fontWeight: 700,
};

const mdComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 style={{ fontSize: 18, margin: "0 0 12px" }} {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 style={{ fontSize: 16, margin: "18px 0 8px" }} {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 style={{ fontSize: 14.5, margin: "14px 0 7px" }} {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p style={{ margin: "0 0 10px", lineHeight: 1.65 }} {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      style={{
        margin: "0 0 12px",
        paddingLeft: 18,
        display: "grid",
        gap: 5,
      }}
      {...props}
    />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      style={{
        margin: "0 0 12px",
        paddingLeft: 18,
        display: "grid",
        gap: 5,
      }}
      {...props}
    />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li style={{ lineHeight: 1.6 }} {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong style={{ fontWeight: 800, color: "#1b2231" }} {...props} />
  ),
};

function detailsText(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function MeetingSummaryPanel({
  meetingId,
  initialSummary,
  initialProvider,
  initialGeneratedAt,
}: Props) {
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [provider, setProvider] = useState(initialProvider ?? "");
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt ?? "");
  const [meta, setMeta] = useState(
    initialGeneratedAt ? `saved at ${initialGeneratedAt}` : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  async function generateSummary() {
    setBusy(true);
    setError("");
    setWarning("");

    try {
      const res = await fetch("/api/summarize-meeting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meetingId }),
      });

      const data = (await res.json()) as SummaryResponse;

      if (!res.ok || data.error) {
        throw new Error(
          [data.error, detailsText(data.details)].filter(Boolean).join(": ")
        );
      }

      setSummary(data.summary ?? "");
      setProvider(data.provider ?? "");
      setGeneratedAt(data.summary_generated_at ?? "");
      setWarning(data.rag_index_warning ?? "");
      setMeta(
        [
          `${data.refined_count ?? 0}/${data.transcript_count ?? 0} refined transcripts used`,
          data.rag_indexed
            ? "RAG indexed"
            : data.rag_index_warning
              ? "RAG index warning"
              : "",
        ]
          .filter(Boolean)
          .join(" · ")
      );
    } catch (err: any) {
      console.error("[MeetingSummaryPanel] failed", err);
      setError(err?.message ?? "Failed to summarize meeting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontWeight: 800 }}>회의 sequential summary</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            refined transcript 기반 시간순 요약 · RAG summary chunk로 저장
          </div>
        </div>

        <button
          type="button"
          onClick={generateSummary}
          disabled={busy}
          style={{
            ...button,
            opacity: busy ? 0.65 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Summarizing..." : summary ? "Regenerate" : "Generate"}
        </button>
      </div>

      <div style={{ padding: 18 }}>
        {error && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {warning && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#fffbeb",
              color: "#92400e",
              border: "1px solid #fde68a",
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            Summary는 저장됐지만 RAG index 갱신에 실패했습니다: {warning}
          </div>
        )}

        {summary ? (
          <>
            <div
              style={{
                maxHeight: 520,
                overflow: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#f8fafc",
                padding: "14px 15px",
                fontSize: 13.5,
                color: "#25303f",
              }}
            >
              <ReactMarkdown components={mdComponents}>
                {summary}
              </ReactMarkdown>
            </div>

            <div
              className="mono"
              style={{
                marginTop: 9,
                fontSize: 10.5,
                color: "#94a3b8",
              }}
            >
              {provider || "local"}
              {meta ? ` · ${meta}` : ""}
              {generatedAt ? ` · ${generatedAt}` : ""}
            </div>
          </>
        ) : (
          <div
            style={{
              padding: 18,
              borderRadius: 10,
              border: "1px dashed #d5dce6",
              color: "#94a3b8",
              fontSize: 13,
              textAlign: "center",
              lineHeight: 1.55,
            }}
          >
            Rewrite가 끝난 뒤 Generate를 누르면 전체 회의 흐름을 시간 순서로 요약하고 RAG summary chunk로 저장합니다.
          </div>
        )}
      </div>
    </section>
  );
}
