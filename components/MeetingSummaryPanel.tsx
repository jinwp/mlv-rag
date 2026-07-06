"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { NotionSlideListItem } from "@/components/NotionSlideContextPicker";

type Props = {
  meetingId: string;
  initialSummary?: string | null;
  initialProvider?: string | null;
  initialGeneratedAt?: string | null;
  selectedNotionSlides?: NotionSlideListItem[];
};

type SlideChunkSync = {
  deletedExisting?: boolean;
  insertedChunks?: number;
  inserted_chunks?: number;
  sourceCount?: number;
  source_count?: number;
};

type SourceCounts = {
  transcripts?: number;
  refined_transcripts?: number;
  notes?: number;
  photos?: number;
  visual_evidence?: number;
  notion_slides?: number;
  chunks?: number;
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
  source_counts?: SourceCounts;
  slide_chunk_sync?: SlideChunkSync;
  slideChunkSync?: SlideChunkSync;
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

function insertedSlideChunks(sync?: SlideChunkSync) {
  if (!sync) return 0;

  return sync.insertedChunks ?? sync.inserted_chunks ?? 0;
}

function sourceMetaText(data: SummaryResponse) {
  const counts = data.source_counts;

  if (counts) {
    return [
      `${counts.refined_transcripts ?? data.refined_count ?? 0}/${
        counts.transcripts ?? data.transcript_count ?? 0
      } refined transcripts`,
      `${counts.notes ?? 0} notes`,
      `${counts.photos ?? 0} photos`,
      `${counts.notion_slides ?? 0} slides`,
      `${counts.chunks ?? 0} chunks`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return `${data.refined_count ?? 0}/${
    data.transcript_count ?? 0
  } refined transcripts used`;
}

export function MeetingSummaryPanel({
  meetingId,
  initialSummary,
  initialProvider,
  initialGeneratedAt,
  selectedNotionSlides = [],
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

  const selectedSlideSummary = useMemo(() => {
    if (selectedNotionSlides.length === 0) return "";

    return selectedNotionSlides.map((slide) => slide.path).join(" | ");
  }, [selectedNotionSlides]);

  async function generateSummary() {
    setBusy(true);
    setError("");
    setWarning("");

    try {
      const notionSlidePathMap = Object.fromEntries(
        selectedNotionSlides.map((slide) => [slide.pageId, slide.path])
      );

      const res = await fetch("/api/summarize-meeting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId,
          notionSlidePageIds: selectedNotionSlides.map((slide) => slide.pageId),
          notionSlidePathMap,
        }),
      });

      const data = (await res.json()) as SummaryResponse;

      if (!res.ok || data.error) {
        throw new Error(
          [data.error, detailsText(data.details)].filter(Boolean).join(": ")
        );
      }

      const slideSync = data.slide_chunk_sync ?? data.slideChunkSync;
      const slideChunkCount = insertedSlideChunks(slideSync);

      setSummary(data.summary ?? "");
      setProvider(data.provider ?? "");
      setGeneratedAt(data.summary_generated_at ?? "");
      setWarning(data.rag_index_warning ?? "");
      setMeta(
        [
          sourceMetaText(data),
          slideChunkCount > 0 ? `${slideChunkCount} slide chunks synced` : "",
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
          <div style={{ fontWeight: 800 }}>Session summary</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            transcript · notes · visual evidence · selected Notion slides 기반
            요약
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
        {selectedNotionSlides.length > 0 && (
          <div
            style={{
              padding: 11,
              borderRadius: 10,
              background: "#eff6ff",
              color: "#1e3a8a",
              border: "1px solid #bfdbfe",
              fontSize: 12.5,
              lineHeight: 1.45,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              Selected slide context: {selectedNotionSlides.length}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                color: "#3550c7",
                wordBreak: "break-word",
              }}
            >
              {selectedSlideSummary}
            </div>
          </div>
        )}

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
            녹음/전사 없이도 이미지 분석 결과, 자체 메모, 선택한 Notion
            slide가 있으면 Generate로 실험 세션 요약을 생성합니다.
          </div>
        )}
      </div>
    </section>
  );
}