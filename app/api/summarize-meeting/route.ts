import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildMeetingMemoryChunks, LOCAL_CHUNKER_ID } from "@/lib/rag/chunking";
import { publicUrl, supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import {
  formatNotionContextsForPrompt,
  loadSelectedNotionPageContexts,
} from "@/lib/notion/context";
import { syncNotionSlideChunksForMeeting } from "@/lib/memory/notionSlideChunks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummarizeBody = {
  meetingId?: string;
  notionSlidePageIds?: string[];
  notionSlidePathMap?: Record<string, string>;
};

type MemoryChunk = {
  id: string;
  meeting_id: string;
  source_type: string;
  source_id?: string | null;
  chunk_index?: number | null;
  memory_kind: string;
  content: string;
  tags?: string[] | null;
  metadata?: any;
  generated_by?: string | null;
  created_at?: string | null;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, value])
  );
}

function fmtElapsed(seconds?: number | null) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
}

function clip(text?: string | null, maxChars = 2500) {
  const cleaned = (text ?? "").replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length <= maxChars) return cleaned;

  return `${cleaned.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function storageUrl(path?: string | null) {
  const cleaned = path?.trim();

  if (!cleaned) return "";

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  return publicUrl(cleaned);
}

function buildMeetingContext(meeting: Meeting) {
  return [
    `Title: ${meeting.title ?? "Untitled meeting"}`,
    `Date: ${meeting.date ?? "Unknown"}`,
    `Project tag: ${meeting.project_tag ?? "None"}`,
    `Participants: ${(meeting.participants ?? []).join(", ") || "Unknown"}`,
    `Agenda: ${meeting.agenda ?? "None"}`,
  ].join("\n");
}

function pickTranscriptText(transcript: Transcript): {
  text: string;
  version: "refined" | "raw";
} {
  const refined = transcript.refined_text?.trim();

  if (refined) return { text: refined, version: "refined" };

  return {
    text: transcript.full_text?.trim() ?? "",
    version: "raw",
  };
}

function hasTranscriptEvidence(transcripts: Transcript[]) {
  return transcripts.some((transcript) => pickTranscriptText(transcript).text);
}

function buildTranscriptContext(transcripts: Transcript[]) {
  if (transcripts.length === 0) return "No transcript was provided.";

  return transcripts
    .map((transcript, index) => {
      const { text, version } = pickTranscriptText(transcript);

      return [
        `Transcript #${index + 1}`,
        `version: ${version}`,
        `created_at: ${transcript.created_at ?? "unknown"}`,
        "",
        clip(text, 8000) || "[empty transcript]",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildNotesContext(notes: Note[]) {
  if (notes.length === 0) return "No human notes were provided.";

  return notes
    .map((note) => `[${fmtElapsed(note.elapsed_seconds)}] ${note.content}`)
    .join("\n");
}

function photoHasEvidence(photo: Photo) {
  return Boolean(
    photo.extracted_text?.trim() ||
      photo.extracted_latex?.trim() ||
      photo.diagram_summary?.trim() ||
      photo.figure_prompt?.trim() ||
      photo.generated_figure_path?.trim() ||
      photo.storage_path?.trim()
  );
}

function buildPhotoContext(photos: Photo[]) {
  const usable = photos.filter(photoHasEvidence);

  if (usable.length === 0) {
    return "No visual evidence was provided.";
  }

  return usable
    .map((photo, index) => {
      const originalUrl = storageUrl(photo.storage_path);
      const generatedFigureUrl = storageUrl(photo.generated_figure_path);

      return [
        `Photo / Visual asset #${index + 1}`,
        `elapsed: ${fmtElapsed(photo.elapsed_seconds)}`,
        `analysis_status: ${photo.analysis_status ?? "unknown"}`,
        `original_image_url: ${originalUrl || "none"}`,
        `generated_figure_url: ${generatedFigureUrl || "none"}`,
        "",
        "OCR text:",
        clip(photo.extracted_text, 1800) || "None",
        "",
        "Extracted LaTeX:",
        clip(photo.extracted_latex, 1800) || "None",
        "",
        "Diagram summary:",
        clip(photo.diagram_summary, 1800) || "None",
        "",
        "Figure prompt:",
        clip(photo.figure_prompt, 1800) || "None",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildStoredChunkContext(chunks: MemoryChunk[]) {
  const evidenceChunks = chunks.filter(
    (chunk) => chunk.memory_kind !== "summary" && chunk.content?.trim()
  );

  if (evidenceChunks.length === 0) {
    return "No stored RAG evidence chunks were available.";
  }

  return evidenceChunks
    .slice(0, 50)
    .map((chunk, index) => {
      const title = [
        `Chunk #${index + 1}`,
        `source=${chunk.source_type}`,
        `kind=${chunk.memory_kind}`,
        `generated_by=${chunk.generated_by ?? "unknown"}`,
      ].join(" · ");

      return [title, clip(chunk.content, 1200)].join("\n");
    })
    .join("\n\n---\n\n");
}

function hasStoredChunkEvidence(chunks: MemoryChunk[]) {
  return chunks.some(
    (chunk) => chunk.memory_kind !== "summary" && chunk.content?.trim()
  );
}

function buildSystemPrompt() {
  return [
    "You summarize a research session from any available evidence.",
    "Answer in Korean.",
    "",
    "Available evidence may include:",
    "- transcripts",
    "- human notes",
    "- visual analysis from meeting images",
    "- extracted equations / LaTeX",
    "- generated figure prompts or generated figure references",
    "- selected Notion slide context",
    "- stored RAG evidence chunks",
    "",
    "If transcripts are available, preserve chronological order and use them as the main temporal backbone.",
    "If transcripts are missing, do not fail and do not say the session had no content.",
    "Instead, produce an experiment/session summary from the available notes, visual evidence, equations, slide context, and RAG chunks.",
    "",
    "Separate directly supported evidence from interpretation.",
    "Do not invent unsupported results, numbers, decisions, action items, or speaker intentions.",
    "When evidence is ambiguous, explicitly mark it as uncertain.",
    "Mention timestamps when visual evidence or notes provide them.",
    "",
    "Rendering rules:",
    "Do not use fenced code blocks such as ```text or ```.",
    "Do not use Markdown tables.",
    "Represent pipelines, transformations, failure patterns, and rules as normal bullets.",
    "Use inline code only for short function names, variable names, method names, or exact identifiers.",
    "Do not wrap natural-language rules, observations, or prompt descriptions in code formatting.",
    "Prefer nested bullets over tables or code blocks.",
    "",
    "Output format:",
    "1. 한눈에 보는 요약",
    "2. 근거별 정리",
    "   - Transcript evidence",
    "   - Visual / equation evidence",
    "   - Slide context evidence",
    "   - Human notes",
    "3. 핵심 주장 또는 실험 목적",
    "4. 관찰된 결과 / 논의 내용",
    "5. 결정 사항",
    "6. 후속 TODO",
    "7. 불확실하거나 확인이 필요한 점",
    "",
    "Return markdown only. No markdown fences.",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SummarizeBody;
    const meetingId = body.meetingId?.trim();

    if (!meetingId) return jsonError("meetingId is required");

    if (!process.env.OPENAI_API_KEY) {
      return jsonError("OPENAI_API_KEY is missing", 500);
    }

    const notionSlidePageIds = normalizeStringArray(body.notionSlidePageIds);
    const notionSlidePathMap = normalizePathMap(body.notionSlidePathMap);

    const [
      { data: meeting, error: meetingError },
      { data: transcripts, error: transcriptError },
      { data: notes, error: noteError },
      { data: photos, error: photoError },
      { data: storedChunks, error: chunkError },
    ] = await Promise.all([
      supabase
        .from("meetings")
        .select("*")
        .eq("id", meetingId)
        .single<Meeting>(),
      supabase
        .from("transcripts")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true })
        .returns<Transcript[]>(),
      supabase
        .from("notes")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("elapsed_seconds", { ascending: true })
        .returns<Note[]>(),
      supabase
        .from("photos")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("elapsed_seconds", { ascending: true })
        .returns<Photo[]>(),
      supabase
        .from("meeting_memory_chunks")
        .select(
          [
            "id",
            "meeting_id",
            "source_type",
            "source_id",
            "chunk_index",
            "memory_kind",
            "content",
            "tags",
            "metadata",
            "generated_by",
            "created_at",
          ].join(",")
        )
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<MemoryChunk[]>(),
    ]);

    if (meetingError || !meeting) {
      return jsonError("meeting not found", 404, meetingError);
    }

    if (transcriptError) {
      return jsonError("failed to load transcripts", 500, transcriptError);
    }

    if (noteError) {
      return jsonError("failed to load notes", 500, noteError);
    }

    if (photoError) {
      return jsonError("failed to load photos", 500, photoError);
    }

    if (chunkError) {
      return jsonError("failed to load memory chunks", 500, chunkError);
    }

    const transcriptList = transcripts ?? [];
    const noteList = notes ?? [];
    const photoList = photos ?? [];
    const chunkList = storedChunks ?? [];

    const notionContexts =
      notionSlidePageIds.length > 0
        ? await loadSelectedNotionPageContexts(notionSlidePageIds, {
            pageIdToPath: notionSlidePathMap,
            maxCharsPerPage: 12000,
            maxDepth: 5,
          })
        : [];

    const hasTranscript = hasTranscriptEvidence(transcriptList);
    const hasNotes = noteList.some((note) => note.content?.trim());
    const hasVisualEvidence = photoList.some(photoHasEvidence);
    const hasSlides = notionContexts.some((context) => context.text?.trim());
    const hasChunks = hasStoredChunkEvidence(chunkList);

    if (!hasTranscript && !hasNotes && !hasVisualEvidence && !hasSlides && !hasChunks) {
      return jsonError(
        "no evidence available for this meeting summary",
        400,
        "Add a transcript, note, analyzed image, selected Notion slide, or stored RAG chunk."
      );
    }

    const meetingContext = buildMeetingContext(meeting);
    const transcriptContext = buildTranscriptContext(transcriptList);
    const notesContext = buildNotesContext(noteList);
    const photoContext = buildPhotoContext(photoList);
    const chunkContext = buildStoredChunkContext(chunkList);
    const notionSlideContext =
      notionContexts.length > 0
        ? formatNotionContextsForPrompt(notionContexts)
        : "No Notion slide context was selected.";

    const model =
      process.env.OPENAI_SUMMARY_MODEL ??
      process.env.OPENAI_REWRITE_MODEL ??
      "gpt-5.5";

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: [
            "Meeting context:",
            meetingContext,
            "",
            "Human notes:",
            notesContext,
            "",
            "Transcript evidence:",
            transcriptContext,
            "",
            "Visual / equation evidence:",
            photoContext,
            "",
            "Selected Notion slide context:",
            notionSlideContext,
            "",
            "Stored RAG evidence chunks:",
            chunkContext,
          ].join("\n"),
        },
      ],
    });

    const summary =
      completion.choices[0]?.message?.content?.trim() ??
      "요약을 생성하지 못했습니다.";

    const summaryGeneratedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        summary_text: summary,
        summary_generated_at: summaryGeneratedAt,
        summary_model: model,
      })
      .eq("id", meetingId);

    if (updateError) {
      return jsonError("failed to save meeting summary", 500, updateError.message);
    }

    let slideChunkSync:
      | {
          deletedExisting: boolean;
          insertedChunks: number;
          sourceCount: number;
        }
      | undefined;

    if (notionContexts.length > 0) {
      slideChunkSync = await syncNotionSlideChunksForMeeting({
        meetingId,
        contexts: notionContexts,
      });
    }

    let ragIndexed = false;
    let ragIndexWarning: string | undefined;

    try {
      const meetingWithSummary: Meeting = {
        ...meeting,
        summary_text: summary,
        summary_generated_at: summaryGeneratedAt,
        summary_model: model,
      };

      const chunks = buildMeetingMemoryChunks({
        meeting: meetingWithSummary,
        transcripts: transcriptList,
        notes: noteList,
        photos: photoList,
      });

      const { error: deleteError } = await supabase
        .from("meeting_memory_chunks")
        .delete()
        .eq("meeting_id", meetingId)
        .eq("generated_by", LOCAL_CHUNKER_ID);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      if (chunks.length > 0) {
        const { error: insertError } = await supabase
          .from("meeting_memory_chunks")
          .insert(chunks);

        if (insertError) {
          throw new Error(insertError.message);
        }
      }

      ragIndexed = true;
    } catch (indexError) {
      ragIndexWarning =
        indexError instanceof Error
          ? indexError.message
          : "failed to update RAG index";
    }

    return NextResponse.json({
      provider: `openai:${model}`,
      summary,
      summary_generated_at: summaryGeneratedAt,
      summary_model: model,
      rag_indexed: ragIndexed,
      rag_index_warning: ragIndexWarning,
      transcript_count: transcriptList.length,
      refined_count: transcriptList.filter((transcript) =>
        transcript.refined_text?.trim()
      ).length,
      source_counts: {
        transcripts: transcriptList.length,
        refined_transcripts: transcriptList.filter((transcript) =>
          transcript.refined_text?.trim()
        ).length,
        notes: noteList.length,
        photos: photoList.length,
        visual_evidence: photoList.filter(photoHasEvidence).length,
        notion_slides: notionContexts.length,
        chunks: chunkList.filter(
          (chunk) => chunk.memory_kind !== "summary" && chunk.content?.trim()
        ).length,
      },
      slide_chunk_sync: slideChunkSync,
    });
  } catch (err: any) {
    console.error("[summarize-meeting] failed", err);

    return jsonError(
      "meeting summarization failed",
      500,
      err?.message ?? String(err)
    );
  }
}