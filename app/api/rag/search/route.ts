import { NextResponse } from "next/server";
import { getDummyChunks } from "@/lib/rag/fixtures";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import type { MemoryChunkRow, RagSearchRequest } from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function POST(request: Request) {
  let body: RagSearchRequest = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const question = body.question?.trim();
  if (!question) return jsonError("question is required");

  if (!isSupabaseConfigured) {
    const results = rankMemoryChunks(question, getDummyChunks(), {
      limit: body.limit,
      projectTag: body.projectTag,
      kinds: body.kinds,
      sortBySimilarity: body.sortBySimilarity !== false,
    });

    return NextResponse.json({
      question,
      demo_mode: true,
      count: results.length,
      results,
    });
  }

  const { data, error } = await supabase
    .from("meeting_memory_chunks")
    .select(
      "id, meeting_id, source_type, source_id, chunk_index, memory_kind, content, speaker, start_seconds, end_seconds, tags, metadata, generated_by, created_at, meetings(title,date,project_tag)"
    )
    .order("created_at", { ascending: false })
    .limit(1000)
    .returns<MemoryChunkRow[]>();

  if (error) {
    return jsonError(
      "failed to read memory chunks. Did you run supabase-rag-schema.sql and index a meeting?",
      500,
      error.message
    );
  }

  const results = rankMemoryChunks(question, data ?? [], {
    limit: body.limit,
    projectTag: body.projectTag,
    kinds: body.kinds,
    sortBySimilarity: body.sortBySimilarity !== false,
  });

  return NextResponse.json({
    question,
    count: results.length,
    results,
  });
}
