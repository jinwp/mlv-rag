import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChunkRequestBody = {
  meetingId?: string;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalizeMeetingId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function loadStoredChunks(meetingId: string) {
  const { data, error } = await supabase
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
        "speaker",
        "start_seconds",
        "end_seconds",
        "tags",
        "metadata",
        "generated_by",
        "created_at",
        "updated_at",
      ].join(",")
    )
    .eq("meeting_id", meetingId)
    .order("generated_by", { ascending: true })
    .order("source_type", { ascending: true })
    .order("memory_kind", { ascending: true })
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function POST(req: Request) {
  let body: ChunkRequestBody = {};

  try {
    body = await req.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const meetingId = normalizeMeetingId(body.meetingId);

  if (!meetingId) {
    return jsonError("meetingId is required");
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      meeting_id: meetingId,
      count: 0,
      chunks: [],
      demo_mode: true,
    });
  }

  try {
    const chunks = await loadStoredChunks(meetingId);

    return NextResponse.json({
      meeting_id: meetingId,
      count: chunks.length,
      chunks,
    });
  } catch (err: any) {
    return jsonError(
      "failed to load stored chunks",
      500,
      err?.message ?? String(err)
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const meetingId = normalizeMeetingId(searchParams.get("meetingId"));

  if (!meetingId) {
    return jsonError("meetingId is required");
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      meeting_id: meetingId,
      count: 0,
      chunks: [],
      demo_mode: true,
    });
  }

  try {
    const chunks = await loadStoredChunks(meetingId);

    return NextResponse.json({
      meeting_id: meetingId,
      count: chunks.length,
      chunks,
    });
  } catch (err: any) {
    return jsonError(
      "failed to load stored chunks",
      500,
      err?.message ?? String(err)
    );
  }
}