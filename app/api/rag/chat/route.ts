import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type {
  MemorySearchResult,
  RagChatMessage,
  RagChatRequest,
  RagChatResponse,
} from "@/lib/rag/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const MAX_PROVIDED_SOURCES = 50;

type ReasoningOnlyRagChatRequest = RagChatRequest & {
  meetingId?: string;
  sources?: MemorySearchResult[];
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

  if (end !== null && end !== undefined && end !== start) {
    return `${fmt(start)}-${fmt(end)}`;
  }

  return fmt(start);
}

function safeSnippet(text: string, max = 1200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function safeEvidenceContent(text: string, max = 1800): string {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}...` : cleaned;
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

function isProvidedSource(value: unknown): value is MemorySearchResult {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<MemorySearchResult>;

  return (
    typeof item.id === "string" &&
    typeof item.meeting_id === "string" &&
    typeof item.content === "string" &&
    typeof item.memory_kind === "string" &&
    typeof item.source_type === "string"
  );
}

function sanitizeProvidedSources(sources: unknown): MemorySearchResult[] {
  if (!Array.isArray(sources)) return [];

  return sources
    .filter(isProvidedSource)
    .slice(0, MAX_PROVIDED_SOURCES)
    .map((source) => ({
      ...source,
      content: safeEvidenceContent(source.content, 4000),
      highlights: Array.isArray(source.highlights) ? source.highlights : [],
      matched_terms: Array.isArray(source.matched_terms) ? source.matched_terms : [],
      score: typeof source.score === "number" ? source.score : 0,
    }));
}

function buildConversationContext(
  chatId: string,
  userMessageId: string,
  history: RagChatMessage[],
  meetingId?: string
): string {
  const lines = history.length
    ? history.map((message) => `- ${message.id} (${message.role}): ${message.content}`)
    : ["- no previous messages"];

  return [
    `Chat session ID: ${chatId}`,
    `Current user message ID: ${userMessageId}`,
    meetingId ? `Selected meeting scope: ${meetingId}` : "Selected meeting scope: not specified",
    "Evidence policy: use only the client-provided evidence chunks. Do not perform or assume any additional retrieval.",
    "Recent chat messages:",
    ...lines,
  ].join("\n");
}

function buildEvidenceBlock(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No provided evidence.";

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
        `meeting_id: ${result.meeting_id}`,
        `meeting: ${title}`,
        `date: ${date}`,
        `project: ${project}`,
        `kind: ${result.memory_kind}`,
        `source: ${result.source_type}`,
        `time: ${time}`,
        `similarity_score: ${result.score.toFixed(2)}`,
        `matched_terms: ${result.matched_terms.join(", ") || "none"}`,
        `content:\n${safeEvidenceContent(result.content)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
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

function fallbackAnswer(
  question: string,
  results: MemorySearchResult[],
  needsApiKey: boolean
): string {
  const prefix = needsApiKey
    ? "OPENAI_API_KEY가 서버에 설정되지 않아 LLM 답변 없이 전달된 evidence만 정리했습니다."
    : "LLM 호출에 실패해 전달된 evidence만 정리했습니다.";

  if (results.length === 0) {
    return `${prefix}\n\n질문: ${question}\n\n현재 전달된 evidence chunk가 없습니다. 먼저 Search를 실행한 뒤 Answer를 눌러야 합니다.`;
  }

  const bullets = results.slice(0, 8).map((result, index) => {
    const title = result.meeting_title ?? result.meeting_id;
    return `- 근거 ${index + 1}: ${title}, ${secondsLabel(
      result.start_seconds,
      result.end_seconds
    )}: ${safeSnippet(result.content, 300)}`;
  });

  return [
    prefix,
    "",
    `질문: ${question}`,
    "",
    "전달된 근거:",
    ...bullets,
  ].join("\n");
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
      max_output_tokens: 1800,
      input: [
        {
          role: "developer",
          content: [
            "You are a Lab Meeting Memory Agent.",
            "Answer in Korean.",
            "Use only the provided evidence chunks. Do not perform, request, or assume any additional retrieval.",
            "Do not invent unsupported facts.",
            "If evidence is weak, missing, or conflicting, explicitly say what is uncertain.",
            "Cite evidence with labels like '(근거 1)', '(근거 2)'.",
            "Give a useful reasoning-oriented answer, not just a list of chunks.",
            "Recommended structure:",
            "1. 결론",
            "2. 근거 기반 분석",
            "3. 후속 TODO 또는 확인할 점",
            "Keep the answer concise but sufficiently analytical.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            params.context,
            `Current question:\n${params.question}`,
            `Provided evidence:\n${params.evidence}`,
          ].join("\n\n"),
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `OpenAI request failed with status ${response.status}`
    );
  }

  const answer = extractOutputText(payload);
  if (!answer) throw new Error("OpenAI response did not include output text");
  return answer;
}

export async function POST(request: Request) {
  let body: ReasoningOnlyRagChatRequest = {};

  try {
    body = await request.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const question = body.question?.trim();
  if (!question) return jsonError("question is required");

  const meetingId = body.meetingId?.trim() || undefined;
  const sources = sanitizeProvidedSources(body.sources);

  if (sources.length === 0) {
    return jsonError("sources are required. Run Search first and pass the displayed evidence chunks.");
  }

  const chatId = cleanId(body.chatId, "chat");
  const userMessageId = cleanId(body.messageId, "user");
  const assistantMessageId = `assistant_${randomUUID()}`;
  const history = sanitizeHistory(body.history);

  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    process.env.OPENAI_RAG_MODEL ||
    process.env.OPENAI_REWRITE_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL;

  const basePayload = {
    chatId,
    userMessageId,
    assistantMessageId,
    sources,
    meeting_id: meetingId ?? null,
    provided_source_count: sources.length,
    demo_mode: false,
    schema_missing: false,
    warning: undefined,
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
      context: buildConversationContext(chatId, userMessageId, history, meetingId),
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
