import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Note } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateNoteBody = {
  meetingId?: string;
  content?: string;
  elapsedSeconds?: number | null;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalizeElapsedSeconds(value: unknown) {
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;

  return Math.max(0, Math.floor(value));
}

export async function POST(req: Request) {
  let body: CreateNoteBody = {};

  try {
    body = await req.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const meetingId = body.meetingId?.trim();
  const content = body.content?.trim();

  if (!meetingId) {
    return jsonError("meetingId is required");
  }

  if (!content) {
    return jsonError("content is required");
  }

  const elapsedSeconds = normalizeElapsedSeconds(body.elapsedSeconds);

  const { data, error } = await supabase
    .from("notes")
    .insert({
      meeting_id: meetingId,
      content,
      elapsed_seconds: elapsedSeconds,
    })
    .select("*")
    .single<Note>();

  if (error) {
    return jsonError("failed to create note", 500, error.message);
  }

  return NextResponse.json({
    ok: true,
    note: data,
  });
}