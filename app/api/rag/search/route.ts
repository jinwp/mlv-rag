import { NextResponse } from "next/server";
import { loadMemoryChunks } from "@/lib/rag/loadMemory";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import type { MemorySearchResult, RagSearchRequest } from "@/lib/rag/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

const DEFAULT_SEARCH_LIMIT = 16;
const MAX_SEARCH_LIMIT = 50;
const RETRIEVAL_POOL_PER_QUERY = 24;
const MAX_RETRIEVAL_QUERIES = 8;
const MAX_SOURCES_PER_MEETING = 5;
const QUERY_REWRITE_MAX_OUTPUT_TOKENS = 700;

type LoadedMemory = Awaited<ReturnType<typeof loadMemoryChunks>>;

type ScopedRagSearchRequest = RagSearchRequest & {
  meetingId?: string;
};

type RagQueryRewrite = {
  standalone_question: string;
  search_queries: string[];
  entities: string[];
  speaker_terms: string[];
  time_hints: string[];
};

type RankedCandidate = {
  key: string;
  result: MemorySearchResult;
  score: number;
  hits: number;
};

type OpenAIResponsePayload = {
  output_text?: unknown;
  output?: unknown;
  error?: {
    message?: string;
  };
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeSnippet(text: string, max = 1200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function extractOutputText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const texts: string[] = [];

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!item || typeof item !== "object" || !("content" in item)) continue;

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (!part || typeof part !== "object" || !("text" in part)) continue;

        const text = (part as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) texts.push(text.trim());
      }
    }
  }

  return texts.join("\n").trim();
}

function safeJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function stringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeRewrite(raw: unknown, question: string): RagQueryRewrite {
  const obj = isRecord(raw) ? raw : {};

  const standalone =
    typeof obj.standalone_question === "string" && obj.standalone_question.trim()
      ? obj.standalone_question.trim()
      : question;

  return {
    standalone_question: standalone,
    search_queries: stringArray(obj.search_queries, 5),
    entities: stringArray(obj.entities, 8),
    speaker_terms: stringArray(obj.speaker_terms, 5),
    time_hints: stringArray(obj.time_hints, 5),
  };
}

function uniqueStrings(values: string[], max = MAX_RETRIEVAL_QUERIES): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();

    if (!cleaned || seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);

    if (result.length >= max) break;
  }

  return result;
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.max(1, Math.min(Math.floor(limit), MAX_SEARCH_LIMIT));
}

function resultKey(result: MemorySearchResult): string {
  return [
    result.id,
    result.meeting_id,
    result.memory_kind,
    result.source_type,
    result.start_seconds ?? "no-start",
    result.end_seconds ?? "no-end",
    result.content.slice(0, 120),
  ].join("::");
}

async function rewriteRagSearchQuery(params: {
  apiKey: string;
  model: string;
  question: string;
}): Promise<RagQueryRewrite> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_output_tokens: QUERY_REWRITE_MAX_OUTPUT_TOKENS,
      input: [
        {
          role: "developer",
          content: [
            "You rewrite Korean lab-memory search questions into retrieval queries.",
            "Your job is query rewriting only. Do not answer the question.",
            "",
            "The search target is an indexed lab meeting memory database.",
            "The indexed chunks may include meeting title, date, project tag, participants, agenda, refined transcripts, raw transcripts, notes, memos, OCR text, photo/diagram analysis, and summaries if they were indexed.",
            "",
            "Resolve vague or short questions into standalone search queries.",
            "Expand acronyms, project names, paper names, benchmarks, method names, model names, and speaker names when inferable from the question.",
            "Produce lexical search queries suitable for BM25/keyword retrieval.",
            "Include both Korean and English technical terms when useful.",
            "Do not invent facts not present in the question.",
            "If the query is ambiguous, include multiple candidate search queries.",
            "",
            "Return strict JSON only with this schema:",
            "{",
            '  "standalone_question": string,',
            '  "search_queries": string[],',
            '  "entities": string[],',
            '  "speaker_terms": string[],',
            '  "time_hints": string[]',
            "}",
          ].join("\n"),
        },
        {
          role: "user",
          content: ["Original search question:", params.question].join("\n"),
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `OpenAI query rewrite failed with status ${response.status}`
    );
  }

  const text = extractOutputText(payload);
  const parsed = safeJsonObject(text);

  return normalizeRewrite(parsed, params.question);
}

function rankWithRewrittenQueries(params: {
  queries: string[];
  chunks: LoadedMemory["chunks"];
  limit: number;
  projectTag?: RagSearchRequest["projectTag"];
  kinds?: RagSearchRequest["kinds"];
  sortBySimilarity: boolean;
}): MemorySearchResult[] {
  const candidates = new Map<string, RankedCandidate>();

  for (const query of params.queries) {
    const ranked = rankMemoryChunks(query, params.chunks, {
      limit: RETRIEVAL_POOL_PER_QUERY,
      projectTag: params.projectTag,
      kinds: params.kinds,
      sortBySimilarity: params.sortBySimilarity,
      includeZero: true,
    });

    for (const result of ranked) {
      const key = resultKey(result);
      const existing = candidates.get(key);

      if (!existing) {
        candidates.set(key, {
          key,
          result,
          score: result.score,
          hits: 1,
        });
      } else {
        existing.score = Math.max(existing.score, result.score);
        existing.hits += 1;
      }
    }
  }

  const sorted = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + Math.min(candidate.hits - 1, 3) * 0.75,
    }))
    .sort((a, b) => b.score - a.score);

  const selected: MemorySearchResult[] = [];
  const perMeeting = new Map<string, number>();

  for (const candidate of sorted) {
    const count = perMeeting.get(candidate.result.meeting_id) ?? 0;
    if (count >= MAX_SOURCES_PER_MEETING) continue;

    selected.push({
      ...candidate.result,
      score: candidate.score,
    });

    perMeeting.set(candidate.result.meeting_id, count + 1);

    if (selected.length >= params.limit) return selected;
  }

  for (const candidate of sorted) {
    if (selected.some((item) => resultKey(item) === candidate.key)) continue;

    selected.push({
      ...candidate.result,
      score: candidate.score,
    });

    if (selected.length >= params.limit) break;
  }

  return selected;
}

export async function POST(request: Request) {
  let body: ScopedRagSearchRequest = {};

  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const question = body.question?.trim();
  if (!question) return jsonError("question is required");

  const meetingId = body.meetingId?.trim() || undefined;

  const loaded = await loadMemoryChunks();

  if (loaded.memoryError && !loaded.demoMode) {
    return jsonError(
      "failed to read memory chunks. Did you run supabase-rag-schema.sql and index a meeting?",
      500,
      loaded.memoryError
    );
  }

  const scopedChunks = meetingId
    ? loaded.chunks.filter((chunk) => chunk.meeting_id === meetingId)
    : loaded.chunks;

  const limit = normalizeLimit(body.limit);
  const sortBySimilarity = body.sortBySimilarity !== false;

  const apiKey = process.env.OPENAI_API_KEY;
  const rewriteModel =
    process.env.OPENAI_QUERY_REWRITE_MODEL ||
    process.env.OPENAI_REWRITE_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL;

  let queryRewrite: RagQueryRewrite | null = null;
  let rewriteWarning: string | undefined;

  if (apiKey && scopedChunks.length > 0) {
    try {
      queryRewrite = await rewriteRagSearchQuery({
        apiKey,
        model: rewriteModel,
        question,
      });
    } catch (error) {
      rewriteWarning =
        error instanceof Error ? error.message : "query rewrite failed";
      console.warn("[rag/search] query rewrite failed:", rewriteWarning);
    }
  } else if (!apiKey) {
    rewriteWarning = "OPENAI_API_KEY is not set. Used the raw search question.";
  } else if (meetingId && scopedChunks.length === 0) {
    rewriteWarning = "Selected meeting has no indexed chunks. Run Rechunk first.";
  }

  const retrievalQueries = uniqueStrings([
    queryRewrite?.standalone_question ?? question,
    ...(queryRewrite?.search_queries ?? []),
    ...(queryRewrite?.entities ?? []),
    ...(queryRewrite?.speaker_terms ?? []),
    question,
  ]);

  const results = rankWithRewrittenQueries({
    queries: retrievalQueries.length ? retrievalQueries : [question],
    chunks: scopedChunks,
    limit,
    projectTag: body.projectTag,
    kinds: body.kinds,
    sortBySimilarity,
  });

  return NextResponse.json({
    question,
    meeting_id: meetingId ?? null,
    scoped_chunk_count: scopedChunks.length,
    rewritten_question: queryRewrite?.standalone_question ?? null,
    retrieval_queries: retrievalQueries,
    query_rewrite: queryRewrite,
    query_rewrite_used: Boolean(queryRewrite),
    query_rewrite_model: queryRewrite ? rewriteModel : null,
    query_rewrite_warning: rewriteWarning,
    demo_mode: loaded.demoMode,
    schema_missing: loaded.schemaMissing,
    warning: loaded.memoryError,
    count: results.length,
    results,
  });
}
