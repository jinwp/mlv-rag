import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getDummyChunks } from "@/lib/rag/fixtures";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import type {
  MemoryChunkRow,
  MemorySearchResult,
  RagChatMessage,
  RagChatRequest,
  RagChatResponse,
} from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

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

function cleanId(value: string | undefined, prefix: string): string {
  const trimmed = value?.trim();
  return trimmed || `${prefix}_${randomUUID()}`;
}

function secondsLabel(start?: number | null, end?: number | null): string {
  if (start === null || start === undefined) return "no timestamp";
  const fmt = (seconds: number) => {
    const rounded = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };
  if (end !== null && end !== undefined && end !== start) return `${fmt(start)}-${fmt(end)}`;
  return fmt(start);
}

function safeSnippet(text: string, max = 1200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function sanitizeHistory(history: RagChatMessage[] | undefined): RagChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (message) =>
        typeof message?.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
    .slice(-10)
    .map((message) => ({
      id: safeSnippet(message.id, 120),
      role: message.role,
      content: safeSnippet(message.content, 1000),
      createdAt: message.createdAt,
    }));
}

function buildConversationContext(chatId: string, userMessageId: string, history: RagChatMessage[]): string {
  const lines = history.length
    ? history.map((message) => `- ${message.id} (${message.role}): ${message.content}`)
    : ["- no previous messages"];

  return [
    `Chat session ID: ${chatId}`,
    `Current user message ID: ${userMessageId}`,
    "Recent chat messages for summary context:",
    ...lines,
  ].join("\n");
}

function buildEvidenceBlock(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No retrieved evidence.";

  return results
    .map((result, index) => {
      const evidenceId = `근거 ${index + 1}`;
      const title = result.meeting_title ?? result.meeting_id;
      const date = result.meeting_date ?? "no-date";
      const project = result.project_tag ?? "미분류";
      const time = secondsLabel(result.start_seconds, result.end_seconds);
      return [
        `[${evidenceId}]`,
        `chunk_id: ${result.id}`,
        `meeting: ${title}`,
        `date: ${date}`,
        `project: ${project}`,
        `kind: ${result.memory_kind}`,
        `source: ${result.source_type}`,
        `time: ${time}`,
        `similarity_score: ${result.score.toFixed(2)}`,
        `content: ${safeSnippet(result.content)}`,
      ].join("\n");
    })
    .join("\n\n");
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

function fallbackAnswer(question: string, results: MemorySearchResult[], needsApiKey: boolean): string {
  const prefix = needsApiKey
    ? "OPENAI_API_KEY가 서버에 설정되지 않아 LLM 호출 없이 검색 evidence만 정리했습니다."
    : "LLM 호출에 실패해 검색 evidence만 정리했습니다.";

  if (results.length === 0) {
    return `${prefix}\n\n질문: ${question}\n\n현재 검색된 근거 chunk가 없습니다.`;
  }

  const bullets = results.slice(0, 3).map((result, index) => {
    const title = result.meeting_title ?? result.meeting_id;
    return `- 근거 ${index + 1}: ${title}, ${secondsLabel(result.start_seconds, result.end_seconds)}: ${
      result.highlights[0] ?? safeSnippet(result.content, 220)
    }`;
  });

  return [prefix, "", `질문: ${question}`, "", "가장 관련 높은 근거:", ...bullets].join("\n");
}

async function loadChunks(): Promise<{ chunks: MemoryChunkRow[]; demoMode: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { chunks: getDummyChunks(), demoMode: true };

  const { data, error } = await supabase
    .from("meeting_memory_chunks")
    .select(
      "id, meeting_id, source_type, source_id, chunk_index, memory_kind, content, speaker, start_seconds, end_seconds, tags, metadata, generated_by, created_at, meetings(title,date,project_tag)"
    )
    .order("created_at", { ascending: false })
    .limit(1000)
    .returns<MemoryChunkRow[]>();

  if (error) return { chunks: [], demoMode: false, error: error.message };
  return { chunks: data ?? [], demoMode: false };
}

async function callOpenAI(params: {
  apiKey: string;
  model: string;
  question: string;
  context: string;
  evidence: string;
}): Promise<string> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      max_output_tokens: 900,
      input: [
        {
          role: "developer",
          content:
            "You are a Lab Meeting Memory Agent. Answer in Korean. Use only the retrieved evidence. " +
            "If the evidence is insufficient, say so explicitly. Cite evidence with labels like '(근거 1)' and never use '[E1]' style labels. " +
            "Keep the answer concise and include decisions, reasons, TODOs, or open questions when supported.",
        },
        {
          role: "user",
          content: [
            params.context,
            `Current question:\n${params.question}`,
            `Retrieved evidence:\n${params.evidence}`,
          ].join("\n\n"),
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenAI request failed with status ${response.status}`);
  }

  const answer = extractOutputText(payload);
  if (!answer) throw new Error("OpenAI response did not include output text");
  return answer;
}

export async function POST(request: Request) {
  let body: RagChatRequest = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const question = body.question?.trim();
  if (!question) return jsonError("question is required");

  const chatId = cleanId(body.chatId, "chat");
  const userMessageId = cleanId(body.messageId, "user");
  const assistantMessageId = `assistant_${randomUUID()}`;
  const history = sanitizeHistory(body.history);

  const loaded = await loadChunks();
  if (loaded.error) {
    return jsonError(
      "failed to read memory chunks. Did you run supabase-rag-schema.sql and index a meeting?",
      500,
      loaded.error
    );
  }

  const sources = rankMemoryChunks(question, loaded.chunks, {
    limit: body.limit,
    projectTag: body.projectTag,
    kinds: body.kinds,
    sortBySimilarity: body.sortBySimilarity !== false,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const basePayload = {
    chatId,
    userMessageId,
    assistantMessageId,
    sources,
    demo_mode: loaded.demoMode,
  };

  if (!apiKey) {
    const payload: RagChatResponse = {
      ...basePayload,
      answer: fallbackAnswer(question, sources, true),
      model: null,
      needs_api_key: true,
    };
    return NextResponse.json(payload);
  }

  try {
    const answer = await callOpenAI({
      apiKey,
      model,
      question,
      context: buildConversationContext(chatId, userMessageId, history),
      evidence: buildEvidenceBlock(sources),
    });

    const payload: RagChatResponse = {
      ...basePayload,
      answer,
      model,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const payload: RagChatResponse = {
      ...basePayload,
      answer: fallbackAnswer(question, sources, false),
      model,
    };
    return NextResponse.json(
      {
        ...payload,
        error: error instanceof Error ? error.message : "OpenAI request failed",
      },
      { status: 502 }
    );
  }
}
