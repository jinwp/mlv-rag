"use client";

import { useMemo, useState } from "react";
import type { Meeting } from "@/lib/types";
import {
  MEETING_MODE_OPTIONS,
  meetingModeTitlePrefix,
  normalizeMeetingMode,
  type MeetingMode,
} from "@/lib/meetings/modes";

type Props = {
  meeting: Meeting;
};

type WriteResponse = {
  ok?: boolean;
  pageId?: string;
  url?: string;
  title?: string;
  parentTitle?: string;
  projectPageCreated?: boolean;
  stats?: {
    transcripts?: number;
    notes?: number;
    photos?: number;
    blocks?: number;
    assets?: {
      total?: number;
      transcriptions?: number;
      visual?: number;
      images?: number;
      equations?: number;
      figures?: number;
    };
  };
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

const primaryButton: React.CSSProperties = {
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 11px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 12.5,
};

const muted: React.CSSProperties = {
  color: "#64748b",
  fontSize: 12,
  lineHeight: 1.45,
};

function peopleTitlePart(participants?: string[] | null) {
  const people = (participants ?? [])
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (people.length === 0) return "Unknown";

  return people.join(", ");
}

function safeTitlePart(value: string) {
  return value
    .replace(/[\\/:*?"<>|#\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function notionTitlePreview(meeting: Meeting, mode: MeetingMode) {
  const date = safeTitlePart(meeting.date?.trim() || "UnknownDate");
  const modePart = safeTitlePart(meetingModeTitlePrefix(mode));
  const title = safeTitlePart(meeting.title?.trim() || "Untitled");
  const people = safeTitlePart(peopleTitlePart(meeting.participants));

  return `${date}-${modePart}-${title}-${people}`;
}

function detailText(details: unknown) {
  if (!details) return "";

  if (typeof details === "string") return details;

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export function MeetingWriteToNotionPanel({ meeting }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WriteResponse | null>(null);
  const [mode, setMode] = useState<MeetingMode>(
    normalizeMeetingMode(meeting.mode)
  );
  const [modeSaving, setModeSaving] = useState(false);

  const titlePreview = useMemo(
    () => notionTitlePreview(meeting, mode),
    [meeting, mode]
  );

  async function updateMode(nextMode: MeetingMode) {
    const prevMode = mode;

    setMode(nextMode);
    setModeSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/meetings/${meeting.id}/mode`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: nextMode,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || data?.error) {
        throw new Error(data?.error ?? "failed to update meeting mode");
      }
    } catch (err) {
      setMode(prevMode);
      setError(err instanceof Error ? err.message : "Failed to update mode.");
    } finally {
      setModeSaving(false);
    }
  }

  async function writeToNotion() {
    setBusy(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/notion/write-meeting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId: meeting.id,
          mode,
        }),
      });

      const data: WriteResponse = await res.json();

      if (!res.ok || data.error) {
        throw new Error(
          `${data.error ?? "write failed"} ${detailText(data.details)}`.trim()
        );
      }

      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to write meeting to Notion"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={card}>
      <div style={cardHead}>
        <div>
          <div style={{ fontWeight: 800 }}>Write to Notion</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>
            toggle page · assets split · no overwrite
          </div>
        </div>

        <span className="mono" style={{ fontSize: 10.5, color: "#aab2c0" }}>
          NOTION
        </span>
      </div>

      <div style={{ padding: 18, display: "grid", gap: 12 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            className="mono"
            style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 5 }}
          >
            PAGE TITLE
          </div>

          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "#334155",
              lineHeight: 1.45,
              wordBreak: "break-word",
            }}
          >
            {titlePreview}
          </div>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>
            Document mode
          </label>

          <select
            value={mode}
            onChange={(e) => updateMode(e.target.value as MeetingMode)}
            disabled={busy || modeSaving}
            style={{
              width: "100%",
              border: "1px solid #d9dee8",
              borderRadius: 9,
              padding: "8px 10px",
              fontSize: 12.5,
              background: "#fff",
              opacity: busy || modeSaving ? 0.65 : 1,
            }}
          >
            {MEETING_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.description}
              </option>
            ))}
          </select>
        </div>

        <div style={muted}>
          Creates a new Notion meeting page under Meetings / project tag. If a
          page with the same title already exists, the write is blocked. Raw
          transcript and visual assets are stored under Assets.
        </div>

        {error && (
          <div
            style={{
              padding: 10,
              borderRadius: 9,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        )}

        {result?.ok && (
          <div
            style={{
              padding: 10,
              borderRadius: 9,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              color: "#166534",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 800 }}>Written to Notion</div>

            <div style={{ marginTop: 4 }}>
              Parent: {result.parentTitle ?? "Unknown"}
            </div>

            <div>
              Blocks: {result.stats?.blocks ?? 0} · Notes:{" "}
              {result.stats?.notes ?? 0} · Photos: {result.stats?.photos ?? 0}
            </div>

            <div>
              Assets: {result.stats?.assets?.total ?? 0} · Transcripts:{" "}
              {result.stats?.assets?.transcriptions ?? 0} · Images:{" "}
              {result.stats?.assets?.images ?? 0} · Equations:{" "}
              {result.stats?.assets?.equations ?? 0} · Figures:{" "}
              {result.stats?.assets?.figures ?? 0}
            </div>

            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 7,
                  color: "#166534",
                  fontWeight: 800,
                  textDecoration: "none",
                }}
              >
                Open in Notion →
              </a>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={writeToNotion}
          disabled={busy}
          style={{
            ...primaryButton,
            opacity: busy ? 0.65 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Writing..." : "Write to Notion"}
        </button>
      </div>
    </section>
  );
}