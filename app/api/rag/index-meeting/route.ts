import { NextResponse } from "next/server";
import { buildMeetingMemoryChunks, LOCAL_CHUNKER_ID } from "@/lib/rag/chunking";
import { getDummyChunks, getDummyMeeting } from "@/lib/rag/fixtures";
import type { IndexMeetingRequest } from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function POST(request: Request) {
  let body: IndexMeetingRequest = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const meetingId = body.meetingId?.trim();
  if (!meetingId) return jsonError("meetingId is required");

  if (!isSupabaseConfigured) {
    const meeting = getDummyMeeting(meetingId);
    if (!meeting) return jsonError("dummy meeting not found", 404);
    const chunks = getDummyChunks(meetingId);
    return NextResponse.json({
      meeting_id: meetingId,
      dry_run: body.dryRun ?? true,
      demo_mode: true,
      generated_by: LOCAL_CHUNKER_ID,
      count: chunks.length,
      chunks,
    });
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .single<Meeting>();

  if (meetingError || !meeting) {
    return jsonError("meeting not found", 404, meetingError?.message);
  }

  const [{ data: transcripts }, { data: notes }, { data: photos }] = await Promise.all([
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

  const chunks = buildMeetingMemoryChunks({
    meeting,
    transcripts: transcripts ?? [],
    notes: notes ?? [],
    photos: photos ?? [],
  });

  if (body.dryRun) {
    return NextResponse.json({
      meeting_id: meetingId,
      dry_run: true,
      generated_by: LOCAL_CHUNKER_ID,
      count: chunks.length,
      chunks,
    });
  }

  const { error: deleteError } = await supabase
    .from("meeting_memory_chunks")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("generated_by", LOCAL_CHUNKER_ID);

  if (deleteError) {
    return jsonError(
      "failed to clear old chunks. Did you run supabase-rag-schema.sql?",
      500,
      deleteError.message
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("meeting_memory_chunks")
    .insert(chunks)
    .select("id");

  if (insertError) {
    return jsonError("failed to insert memory chunks", 500, insertError.message);
  }

  return NextResponse.json({
    meeting_id: meetingId,
    generated_by: LOCAL_CHUNKER_ID,
    count: inserted?.length ?? chunks.length,
  });
}
