import { NextResponse } from "next/server";
import { MEDIA_BUCKET, supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type DeleteBody = {
  meetingId?: string;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])
  );
}

async function deleteOptionalRows(table: string, meetingId: string) {
  const { error } = await supabase.from(table).delete().eq("meeting_id", meetingId);

  if (!error) return;

  const ignorableCodes = new Set([
    "42P01", // undefined_table
    "42703", // undefined_column
    "PGRST106",
    "PGRST200",
    "PGRST204",
  ]);

  if (error.code && ignorableCodes.has(error.code)) return;

  throw error;
}

async function deleteRequiredRows(table: string, meetingId: string) {
  const { error } = await supabase.from(table).delete().eq("meeting_id", meetingId);
  if (error) throw error;
}

export async function DELETE(request: Request) {
  let body: DeleteBody = {};

  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const meetingId = body.meetingId?.trim();
  if (!meetingId) return jsonError("meetingId is required");

  try {
    const [{ data: meeting }, { data: photos }, { data: transcripts }] =
      await Promise.all([
        supabase.from("meetings").select("id").eq("id", meetingId).single(),
        supabase
          .from("photos")
          .select("storage_path, generated_figure_path")
          .eq("meeting_id", meetingId),
        supabase
          .from("transcripts")
          .select("audio_path")
          .eq("meeting_id", meetingId),
      ]);

    if (!meeting) {
      return jsonError("meeting not found", 404);
    }

    const storagePaths = uniqueNonEmpty([
      ...(photos ?? []).flatMap((photo) => [
        photo.storage_path,
        photo.generated_figure_path,
      ]),
      ...(transcripts ?? []).map((transcript) => transcript.audio_path),
    ]);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .remove(storagePaths);

      if (storageError) {
        console.warn("[delete meeting] storage remove failed", storageError);
      }
    }

    await deleteOptionalRows("meeting_chat_context_selections", meetingId);
    await deleteOptionalRows("meeting_memory_chunks", meetingId);
    await deleteOptionalRows("memory_extractions", meetingId);

    await deleteRequiredRows("notes", meetingId);
    await deleteRequiredRows("photos", meetingId);
    await deleteRequiredRows("transcripts", meetingId);

    const { error: meetingDeleteError } = await supabase
      .from("meetings")
      .delete()
      .eq("id", meetingId);

    if (meetingDeleteError) throw meetingDeleteError;

    return NextResponse.json({
      ok: true,
      meetingId,
      removedStorageObjects: storagePaths.length,
    });
  } catch (error) {
    console.error("[delete meeting] failed", error);
    return jsonError(
      "failed to delete meeting",
      500,
      error instanceof Error ? error.message : error
    );
  }
}