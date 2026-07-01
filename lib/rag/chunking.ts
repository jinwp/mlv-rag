import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import type { MemoryChunkInput } from "@/lib/rag/types";

export const LOCAL_CHUNKER_ID = "local-chunker-v1";

const DEFAULT_MAX_CHARS = 900;
const DEFAULT_OVERLAP_CHARS = 160;
const TIMESTAMP_RE = /(?:^|\s)\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]?/;
const SPEAKER_RE = /^([A-Za-z0-9가-힣_. -]{1,28})\s*[:：]\s*(.+)$/;

type BuildInput = {
  meeting: Meeting;
  transcripts?: Transcript[];
  notes?: Note[];
  photos?: Photo[];
};

type TextSlice = {
  text: string;
  start_seconds: number | null;
  end_seconds: number | null;
  speaker: string | null;
};

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function parseTimestamp(text: string): number | null {
  const m = text.match(TIMESTAMP_RE);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  if ([h, min, sec].some(Number.isNaN)) return null;
  return h * 3600 + min * 60 + sec;
}

function stripLeadingTimestamp(text: string): string {
  return text.replace(/^\s*\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]?\s*/, "").trim();
}

function extractSpeaker(text: string): { speaker: string | null; text: string } {
  const m = text.match(SPEAKER_RE);
  if (!m) return { speaker: null, text };
  return { speaker: m[1].trim(), text: m[2].trim() };
}

function splitLongText(text: string, maxChars = DEFAULT_MAX_CHARS, overlap = DEFAULT_OVERLAP_CHARS): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs.length ? paragraphs : [cleaned]) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (`${current}\n\n${paragraph}`.length <= maxChars) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    current = paragraph;
  }
  if (current) chunks.push(current);

  const sliced: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      sliced.push(chunk);
      continue;
    }
    let start = 0;
    while (start < chunk.length) {
      const end = Math.min(chunk.length, start + maxChars);
      sliced.push(chunk.slice(start, end).trim());
      if (end >= chunk.length) break;
      start = Math.max(0, end - overlap);
    }
  }
  return sliced.filter(Boolean);
}

function transcriptSlices(fullText: string): TextSlice[] {
  const cleaned = cleanText(fullText);
  if (!cleaned) return [];

  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasLineTimestamps = lines.some((line) => parseTimestamp(line) !== null);

  if (!hasLineTimestamps) {
    return splitLongText(cleaned).map((text) => ({
      text,
      start_seconds: null,
      end_seconds: null,
      speaker: null,
    }));
  }

  const slices: TextSlice[] = [];
  let current: TextSlice | null = null;

  for (const rawLine of lines) {
    const ts = parseTimestamp(rawLine);
    const withoutTs = stripLeadingTimestamp(rawLine);
    const speaker = extractSpeaker(withoutTs);
    const lineText = speaker.text || withoutTs;

    if (ts !== null) {
      if (current) {
        current.end_seconds = Math.max(current.start_seconds ?? ts, ts);
        slices.push(current);
      }
      current = {
        text: lineText,
        start_seconds: ts,
        end_seconds: null,
        speaker: speaker.speaker,
      };
      continue;
    }

    if (!current) {
      current = {
        text: lineText,
        start_seconds: null,
        end_seconds: null,
        speaker: speaker.speaker,
      };
    } else {
      current.text = `${current.text}\n${lineText}`;
      current.speaker = current.speaker ?? speaker.speaker;
    }
  }

  if (current) slices.push(current);
  return slices.flatMap((slice) =>
    splitLongText(slice.text).map((text) => ({
      ...slice,
      text,
    }))
  );
}

function meetingMetaChunk(meeting: Meeting): MemoryChunkInput {
  const participants = (meeting.participants ?? []).join(", ") || "unknown";
  const parts = [
    `Title: ${meeting.title}`,
    `Date: ${meeting.date ?? "unknown"}`,
    `Project: ${meeting.project_tag ?? "unclassified"}`,
    `Participants: ${participants}`,
  ];
  if (meeting.agenda?.trim()) parts.push(`Agenda: ${meeting.agenda.trim()}`);

  return {
    meeting_id: meeting.id,
    source_type: "meeting",
    source_id: null,
    chunk_index: 0,
    memory_kind: "meeting_meta",
    content: parts.join("\n"),
    tags: [meeting.project_tag ?? "unclassified", "meeting-meta"],
    metadata: { title: meeting.title, date: meeting.date },
    generated_by: LOCAL_CHUNKER_ID,
  };
}

export function buildMeetingMemoryChunks({
  meeting,
  transcripts = [],
  notes = [],
  photos = [],
}: BuildInput): MemoryChunkInput[] {
  const chunks: MemoryChunkInput[] = [meetingMetaChunk(meeting)];
  const baseTags = [meeting.project_tag ?? "unclassified"].filter(Boolean);

  for (const transcript of transcripts) {
    transcriptSlices(transcript.full_text).forEach((slice, index) => {
      chunks.push({
        meeting_id: meeting.id,
        source_type: "transcript",
        source_id: transcript.id,
        chunk_index: index,
        memory_kind: "raw_transcript",
        content: slice.text,
        speaker: slice.speaker,
        start_seconds: slice.start_seconds,
        end_seconds: slice.end_seconds,
        tags: [...baseTags, "transcript"],
        metadata: { audio_path: transcript.audio_path },
        generated_by: LOCAL_CHUNKER_ID,
      });
    });
  }

  notes.forEach((note, index) => {
    const content = cleanText(note.content);
    if (!content) return;
    chunks.push({
      meeting_id: meeting.id,
      source_type: "note",
      source_id: note.id,
      chunk_index: index,
      memory_kind: "note",
      content,
      start_seconds: note.elapsed_seconds,
      end_seconds: note.elapsed_seconds,
      tags: [...baseTags, "note"],
      metadata: {},
      generated_by: LOCAL_CHUNKER_ID,
    });
  });

  photos.forEach((photo, index) => {
    chunks.push({
      meeting_id: meeting.id,
      source_type: "photo",
      source_id: photo.id,
      chunk_index: index,
      memory_kind: "board_capture",
      content: `Board or meeting photo captured at ${photo.elapsed_seconds} seconds. Storage path: ${photo.storage_path}`,
      start_seconds: photo.elapsed_seconds,
      end_seconds: photo.elapsed_seconds,
      tags: [...baseTags, "photo", "board-capture"],
      metadata: { storage_path: photo.storage_path },
      generated_by: LOCAL_CHUNKER_ID,
    });
  });

  return chunks.filter((chunk) => chunk.content.trim().length > 0);
}
