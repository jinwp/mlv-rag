import { NextResponse } from "next/server";
import { loadMemoryChunks } from "@/lib/rag/loadMemory";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import type { RagSearchRequest } from "@/lib/rag/types";

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

  const loaded = await loadMemoryChunks();
  if (loaded.memoryError && !loaded.demoMode) {
    return jsonError(
      "failed to read memory chunks. Did you run supabase-rag-schema.sql and index a meeting?",
      500,
      loaded.memoryError
    );
  }

  const results = rankMemoryChunks(question, loaded.chunks, {
    limit: body.limit,
    projectTag: body.projectTag,
    kinds: body.kinds,
    sortBySimilarity: body.sortBySimilarity !== false,
  });

  return NextResponse.json({
    question,
    demo_mode: loaded.demoMode,
    schema_missing: loaded.schemaMissing,
    warning: loaded.memoryError,
    count: results.length,
    results,
  });
}
