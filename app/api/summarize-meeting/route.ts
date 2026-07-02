import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildMeetingMemoryChunks, LOCAL_CHUNKER_ID } from "@/lib/rag/chunking";
import { supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummarizeBody = {
  meetingId?: string;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
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
    text: transcript.full_text ?? "",
    version: "raw",
  };
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
        text.trim() || "[empty transcript]",
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SummarizeBody;
    const meetingId = body.meetingId?.trim();

    if (!meetingId) return jsonError("meetingId is required");

    if (!process.env.OPENAI_API_KEY) {
      return jsonError("OPENAI_API_KEY is missing", 500);
    }

    const [
      { data: meeting, error: meetingError },
      { data: transcripts, error: transcriptError },
      { data: notes, error: noteError },
      { data: photos, error: photoError },
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

    const transcriptList = transcripts ?? [];
    const noteList = notes ?? [];
    const photoList = photos ?? [];

    if (transcriptList.length === 0) {
      return jsonError("no transcript available for this meeting", 400);
    }

    const meetingContext = buildMeetingContext(meeting);
    const transcriptContext = buildTranscriptContext(transcriptList);
    const notesContext = buildNotesContext(noteList);

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
          content: [
            "You summarize research meeting transcripts.",
            "Answer in Korean.",
            "Use the transcript as the primary source.",
            "Prefer refined transcripts when available.",
            "Use human notes only as auxiliary context.",
            "Do not invent unsupported decisions, action items, or speaker intentions.",
            "Preserve chronological order.",
            "When possible, mention timestamps and speaker names.",
            "",
            "Output format:",
            "1. 한눈에 보는 요약",
            "2. 시간 순서 요약",
            "3. 결정 사항",
            "4. 후속 TODO",
            "5. 불확실하거나 확인이 필요한 점",
            "",
            "Return markdown only. No markdown fences.",
          ].join("\n"),
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
            "Transcript:",
            transcriptContext,
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

      const { error: insertError } = await supabase
        .from("meeting_memory_chunks")
        .insert(chunks);

      if (insertError) {
        throw new Error(insertError.message);
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
