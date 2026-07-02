import OpenAI from "openai";
import { NextResponse } from "next/server";
import { loadMemoryChunks } from "@/lib/rag/loadMemory";
import { rankMemoryChunks } from "@/lib/rag/retrieval";
import type { MemorySearchResult } from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { AskHistoryMessage, AskMode, AskResponse, AskSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const MAX_LOCAL_SOURCES = 16;
const RETRIEVAL_POOL_PER_QUERY = 24;
const MAX_RETRIEVAL_QUERIES = 8;
const MAX_SOURCES_PER_MEETING = 4;
const QUERY_REWRITE_MAX_OUTPUT_TOKENS = 700;

type AskRequest = {
  question?: string;
  mode?: AskMode;
  useWebSearch?: boolean;
  history?: AskHistoryMessage[];
  chatId?: string;
};

type ExtractedOutput = {
  text: string;
  webSources: AskSource[];
  webSearchUsed: boolean;
};

type ChatStorage = {
  chatId?: string;
  userMessageId?: string;
  storageError?: string;
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

type LoadedMemory = Awaited<ReturnType<typeof loadMemoryChunks>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function normalizeMode(body: AskRequest): AskMode {
  if (body.mode === "rag" || body.mode === "web" || body.mode === "plain") return body.mode;
  return body.useWebSearch ? "web" : "rag";
}

function sanitizeHistory(history: AskHistoryMessage[] | undefined): AskHistoryMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
    )
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: safeSnippet(message.content, 1600),
    }));
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

function memorySourceLabel(index: number): string {
  return `근거 ${index + 1}`;
}

function toAskSources(results: MemorySearchResult[]): AskSource[] {
  return results.map((result, index) => {
    const title = result.meeting_title ?? result.meeting_id;
    const time = secondsLabel(result.start_seconds, result.end_seconds);
    const date = result.meeting_date ?? "날짜 없음";
    const label = memorySourceLabel(index);

    return {
      label,
      type: "meeting",
      title,
      text: result.highlights.length ? result.highlights.join("\n") : safeSnippet(result.content, 500),
      reason: `${title} · ${date} · ${time}`,
      meeting_id: result.meeting_id,
      timestamp: result.start_seconds ?? undefined,
      score: result.score,
    };
  });
}

function resultKey(result: MemorySearchResult): string {
  return [
    result.meeting_id,
    result.memory_kind,
    result.start_seconds ?? "no-start",
    result.end_seconds ?? "no-end",
    result.content.slice(0, 120),
  ].join("::");
}

function rankWithRewrittenQueries(params: {
  queries: string[];
  chunks: LoadedMemory["chunks"];
  limit: number;
}): MemorySearchResult[] {
  const candidates = new Map<string, RankedCandidate>();

  for (const query of params.queries) {
    const ranked = rankMemoryChunks(query, params.chunks, {
      limit: RETRIEVAL_POOL_PER_QUERY,
      sortBySimilarity: true,
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

function buildEvidenceBlock(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No local meeting-memory evidence was retrieved.";

  const groups = new Map<string, MemorySearchResult[]>();

  for (const result of results) {
    const key = result.meeting_id;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.entries()]
    .map(([_meetingId, items]) => {
      const first = items[0];
      const meetingTitle = first.meeting_title ?? first.meeting_id;
      const meetingDate = first.meeting_date ?? "no-date";
      const projectTag = first.project_tag ?? "미분류";

      const evidenceLines = items.map((result) => {
        const index = results.indexOf(result);
        const label = memorySourceLabel(index);
        const time = secondsLabel(result.start_seconds, result.end_seconds);

        return [
          `[${label}]`,
          `time: ${time}`,
          `kind: ${result.memory_kind}`,
          `similarity_score: ${result.score.toFixed(2)}`,
          `content: ${safeSnippet(result.content)}`,
        ].join("\n");
      });

      return [
        `Meeting: ${meetingTitle}`,
        `date: ${meetingDate}`,
        `project: ${projectTag}`,
        "",
        evidenceLines.join("\n\n"),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function extractOpenAIOutput(response: unknown): ExtractedOutput {
  const responseObj = isRecord(response) ? response : {};
  const outputText =
    typeof responseObj.output_text === "string" ? responseObj.output_text.trim() : "";

  const fallbackTexts: string[] = [];
  const webSources: AskSource[] = [];
  let webSearchUsed = false;

  const output = Array.isArray(responseObj.output) ? responseObj.output : [];

  for (const item of output) {
    if (!isRecord(item)) continue;

    if (item.type === "web_search_call") webSearchUsed = true;

    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const content of contentItems) {
      if (!isRecord(content)) continue;

      if (typeof content.text === "string" && content.text.trim()) {
        fallbackTexts.push(content.text.trim());
      }

      const annotations = Array.isArray(content.annotations) ? content.annotations : [];
      for (const annotation of annotations) {
        if (!isRecord(annotation)) continue;

        if (annotation.type !== "url_citation") continue;
        if (typeof annotation.url !== "string" || !annotation.url) continue;
        if (webSources.some((existing) => existing.url === annotation.url)) continue;

        webSources.push({
          label: `웹 ${webSources.length + 1}`,
          type: "web",
          title:
            typeof annotation.title === "string" && annotation.title
              ? annotation.title
              : annotation.url,
          text:
            typeof annotation.title === "string" && annotation.title
              ? annotation.title
              : annotation.url,
          reason: "웹 검색 출처",
          url: annotation.url,
        });
      }
    }
  }

  return {
    text: outputText || fallbackTexts.filter(Boolean).join("\n").trim(),
    webSources,
    webSearchUsed,
  };
}

function fallbackAnswer(params: {
  question: string;
  mode: AskMode;
  sources: AskSource[];
  needsApiKey: boolean;
  memoryError?: string;
}): string {
  const { question, mode, sources, needsApiKey, memoryError } = params;
  if (mode === "plain") {
    return needsApiKey
      ? "OPENAI_API_KEY가 서버에 설정되지 않아 Plain Chatbot 답변을 생성할 수 없습니다.\n\nPlain 모드는 회의 DB나 웹 검색 없이, 현재 채팅 history를 바탕으로 분석과 디스커션을 하는 모드입니다."
      : "LLM 호출에 실패해 Plain Chatbot 답변을 생성하지 못했습니다.";
  }

  if (mode === "web") {
    return needsApiKey
      ? "OPENAI_API_KEY가 서버에 설정되지 않아 웹 검색 답변을 생성할 수 없습니다.\n\n웹 검색 모드는 OpenAI Responses API의 web_search tool을 사용합니다."
      : "LLM 웹 검색 호출에 실패했습니다.";
  }

  const lines = [
    needsApiKey
      ? "OPENAI_API_KEY가 서버에 설정되지 않아 LLM 호출 없이 검색 근거만 정리했습니다."
      : "LLM 호출에 실패해 검색 근거만 정리했습니다.",
    "",
    `질문: ${question}`,
  ];

  if (memoryError) {
    lines.push("", `로컬 메모리 DB를 읽는 중 문제가 있었습니다: ${memoryError}`);
  }

  if (sources.length === 0) {
    lines.push("", "현재 연결된 회의 근거가 없습니다.");
    return lines.join("\n");
  }

  lines.push("", "가장 관련 높은 회의 근거:");
  for (const source of sources.slice(0, 5)) {
    lines.push(`- ${source.label ?? "근거"}: ${source.reason}`);
    lines.push(`  ${source.text}`);
  }
  return lines.join("\n");
}

function buildDeveloperPrompt(mode: AskMode): string {
  if (mode === "rag") {
    return [
      "You are a Korean lab meeting-memory RAG assistant.",
      "Answer using local meeting-memory evidence only.",
      "Do not use outside knowledge for private lab decisions, meeting discussions, or project history.",
      "The retrieved evidence may come from multiple meetings. Synthesize across meetings when useful.",
      "",
      "Rules:",
      "- Start with a direct answer.",
      "- Then explain the evidence-based reasoning.",
      "- Preserve speaker attribution when speaker names are present.",
      "- Distinguish decisions, reasons, alternatives, and TODOs.",
      "- If evidence is insufficient, say exactly what is missing.",
      "- Do not invent unsupported intentions or decisions.",
      "- Cite factual claims with labels like '(근거 1)' or '(근거 2)'.",
      "- Never use '[E1]' style labels.",
      "",
      "Preferred format:",
      "## 결론",
      "## 근거 기반 정리",
      "## 회의별 맥락",
      "## 확인이 필요한 점",
    ].join("\n");
  }

  if (mode === "web") {
    return [
      "You are a Korean web-search chatbot.",
      "Use the hosted web search tool for current or public information.",
      "Use the recent chat history to resolve contextual references in the user's latest request.",
      "When the user asks for papers, related work, prior work, or other literature, search for public scholarly or technical sources.",
      "If the latest request contains expressions such as '위 내용', '이 주장', '그 문제', '아까 말한 것', or 'this point', infer the target from the recent chat history before searching.",
      "Do not claim to know private lab meeting decisions unless the user provides them in the conversation.",
      "Clearly separate what comes from web sources from what is inferred from the conversation.",
      "Use concise Markdown and cite web sources when available.",
    ].join("\n");
  }

  return [
    "You are a Korean plain chatbot for analysis and discussion.",
    "Do not use web search and do not use local RAG evidence.",
    "Base your answer on the current conversation history and the user's latest message.",
    "Help reason, compare options, critique ideas, and propose next steps.",
    "Use concise Markdown.",
  ].join("\n");
}

async function rewriteRagQuery(params: {
  apiKey: string;
  model: string;
  question: string;
  history: AskHistoryMessage[];
}): Promise<RagQueryRewrite> {
  const openai = new OpenAI({ apiKey: params.apiKey });

  const historyText =
    params.history.length > 0
      ? params.history.map((message) => `${message.role}: ${message.content}`).join("\n")
      : "No prior chat history.";

  const requestPayload = {
    model: params.model,
    max_output_tokens: QUERY_REWRITE_MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "developer",
        content: [
          "You rewrite Korean lab-memory questions into retrieval queries.",
          "Your job is query rewriting only. Do not answer the question.",
          "",
          "Use the latest question and recent chat history.",
          "Resolve pronouns, ellipses, and references such as '그거', '아까 말한 것', '그 교수님', '그 benchmark'.",
          "Expand project names, paper names, benchmarks, method names, model names, and speaker names when inferable from history.",
          "Produce lexical search queries suitable for BM25/keyword retrieval over meeting transcripts, notes, OCR, and summaries.",
          "Do not invent facts not supported by the chat history.",
          "If the reference is ambiguous, include multiple candidate search queries.",
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
        content: [
          "Recent chat history:",
          historyText,
          "",
          "Latest user question:",
          params.question,
        ].join("\n"),
      },
    ],
  } as Parameters<typeof openai.responses.create>[0];

  const response = await openai.responses.create(requestPayload);
  const extracted = extractOpenAIOutput(response);
  const parsed = safeJsonObject(extracted.text);

  return normalizeRewrite(parsed, params.question);
}

async function callOpenAI(params: {
  apiKey: string;
  model: string;
  mode: AskMode;
  question: string;
  rewrittenQuestion?: string;
  retrievalQueries?: string[];
  localEvidence: string;
  history: AskHistoryMessage[];
  memoryError?: string;
}): Promise<ExtractedOutput> {
  const openai = new OpenAI({ apiKey: params.apiKey });
  const currentContent =
    params.mode === "rag"
      ? [
          `Original user question:\n${params.question}`,
          params.rewrittenQuestion
            ? `Standalone rewritten question:\n${params.rewrittenQuestion}`
            : "",
          params.retrievalQueries?.length
            ? `Retrieval queries used:\n${params.retrievalQueries
                .map((query, index) => `${index + 1}. ${query}`)
                .join("\n")}`
            : "",
          `Local meeting-memory evidence:\n${params.localEvidence}`,
          params.memoryError ? `Memory DB warning:\n${params.memoryError}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : params.mode === "web"
        ? [
            "Use the recent chat history to resolve references in the latest request before searching.",
            "If the latest request contains expressions such as '위 내용', '이 주장', '그 문제', '아까 말한 것', 'that point', or 'this claim', infer the target from the recent chat history.",
            "Search the web for public papers, technical reports, documentation, or credible posts that discuss the resolved topic.",
            "Do not search only the literal latest request if it contains unresolved references.",
            "When the user asks for literature, prioritize scholarly/technical sources and explain how each source relates to the resolved claim.",
            "",
            `Latest user request:\n${params.question}`,
          ].join("\n\n")
        : params.question;

  const requestPayload = {
    model: params.model,
    max_output_tokens: params.mode === "rag" ? 1600 : 1000,
    ...(params.mode === "web"
      ? {
          tools: [{ type: "web_search_preview", search_context_size: "low" }],
          tool_choice: "auto",
        }
      : {}),
    input: [
      {
        role: "developer",
        content: buildDeveloperPrompt(params.mode),
      },
      ...params.history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: currentContent,
      },
    ],
  } as Parameters<typeof openai.responses.create>[0];

  const response = await openai.responses.create(requestPayload);
  const extracted = extractOpenAIOutput(response);
  if (!extracted.text) throw new Error("OpenAI response did not include output text");
  return extracted;
}

function chatTitle(question: string): string {
  const compact = safeSnippet(question, 80);
  return compact || "Untitled chat";
}

async function ensureChatStorage(params: {
  requestedChatId?: string;
  question: string;
  mode: AskMode;
  history: AskHistoryMessage[];
}): Promise<ChatStorage> {
  if (!isSupabaseConfigured) return {};

  let chatId = params.requestedChatId?.trim() || "";

  try {
    if (chatId) {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("id", chatId)
        .maybeSingle();

      if (error) throw error;
      if (!data) chatId = "";
    }

    if (!chatId) {
      const { data, error } = await supabase
        .from("chat_sessions")
        .insert({
          title: chatTitle(params.question),
          mode: params.mode,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;
      chatId = (data as { id: string }).id;
    } else {
      await supabase
        .from("chat_sessions")
        .update({ mode: params.mode, updated_at: new Date().toISOString() })
        .eq("id", chatId);
    }

    const userMessageId = await insertChatMessage({
      chatId,
      role: "user",
      content: params.question,
      mode: params.mode,
      sources: [],
      metadata: { history_count: params.history.length },
    });

    return { chatId, userMessageId };
  } catch (error) {
    const storageError = error instanceof Error ? error.message : "chat storage failed";
    console.warn("[ask] chat storage disabled:", storageError);
    return { storageError };
  }
}

async function insertChatMessage(params: {
  chatId?: string;
  role: "user" | "assistant";
  content: string;
  mode: AskMode;
  sources: AskSource[];
  metadata?: Record<string, unknown>;
}): Promise<string | undefined> {
  if (!isSupabaseConfigured || !params.chatId) return undefined;

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      chat_id: params.chatId,
      role: params.role,
      content: params.content,
      mode: params.mode,
      sources: params.sources,
      metadata: params.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[ask] failed to store chat message:", error.message);
    return undefined;
  }

  await supabase
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString(), mode: params.mode })
    .eq("id", params.chatId);

  return (data as { id: string }).id;
}

async function responseWithStoredAssistant(
  payload: AskResponse,
  status: number,
  chat: ChatStorage,
  mode: AskMode,
  metadata?: Record<string, unknown>
) {
  const assistantMessageId = await insertChatMessage({
    chatId: chat.chatId,
    role: "assistant",
    content: payload.answer,
    mode,
    sources: payload.sources,
    metadata,
  });

  return NextResponse.json(
    {
      ...payload,
      chat_id: chat.chatId,
      user_message_id: chat.userMessageId,
      assistant_message_id: assistantMessageId,
    },
    { status }
  );
}

export async function POST(request: Request) {
  let body: AskRequest = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const mode = normalizeMode(body);
  const history = sanitizeHistory(body.history);

  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    mode === "web"
      ? process.env.OPENAI_WEB_SEARCH_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
      : process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  const rewriteModel =
    process.env.OPENAI_QUERY_REWRITE_MODEL ||
    process.env.OPENAI_REWRITE_MODEL ||
    model;

  const loaded: LoadedMemory =
    mode === "rag"
      ? await loadMemoryChunks()
      : { chunks: [], demoMode: false };

  let queryRewrite: RagQueryRewrite | null = null;

  if (mode === "rag" && apiKey && loaded.chunks.length > 0) {
    try {
      queryRewrite = await rewriteRagQuery({
        apiKey,
        model: rewriteModel,
        question,
        history,
      });
    } catch (error) {
      console.warn(
        "[ask] query rewrite failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  const retrievalQueries =
    mode === "rag"
      ? uniqueStrings([
          queryRewrite?.standalone_question ?? question,
          ...(queryRewrite?.search_queries ?? []),
          ...(queryRewrite?.entities ?? []),
          ...(queryRewrite?.speaker_terms ?? []),
          question,
        ])
      : [];

  const results =
    mode === "rag"
      ? rankWithRewrittenQueries({
          queries: retrievalQueries.length ? retrievalQueries : [question],
          chunks: loaded.chunks,
          limit: MAX_LOCAL_SOURCES,
        })
      : [];

  const localSources = toAskSources(results);

  const chat = await ensureChatStorage({
    requestedChatId: body.chatId,
    question,
    mode,
    history,
  });

  if (!apiKey) {
    const payload: AskResponse = {
      answer: fallbackAnswer({
        question,
        mode,
        sources: localSources,
        needsApiKey: true,
        memoryError: loaded.memoryError,
      }),
      sources: localSources,
      mode,
      model: null,
      demo_mode: loaded.demoMode,
      schema_missing: loaded.schemaMissing,
      memory_error: loaded.memoryError,
      needs_api_key: true,
      web_search_enabled: mode === "web",
      web_search_used: false,
      chat_id: chat.chatId,
      user_message_id: chat.userMessageId,
    };

    return responseWithStoredAssistant(payload, 200, chat, mode, {
      needs_api_key: true,
      storage_error: chat.storageError,
      retrieval_queries: retrievalQueries,
      query_rewrite: queryRewrite,
    });
  }

  try {
    const output = await callOpenAI({
      apiKey,
      model,
      mode,
      question,
      rewrittenQuestion: queryRewrite?.standalone_question,
      retrievalQueries,
      localEvidence: buildEvidenceBlock(results),
      history,
      memoryError: loaded.memoryError,
    });

    const payload: AskResponse = {
      answer: output.text,
      sources: [...localSources, ...output.webSources],
      mode,
      model,
      demo_mode: loaded.demoMode,
      schema_missing: loaded.schemaMissing,
      memory_error: loaded.memoryError,
      web_search_enabled: mode === "web",
      web_search_used: output.webSearchUsed,
      chat_id: chat.chatId,
      user_message_id: chat.userMessageId,
    };

    return responseWithStoredAssistant(payload, 200, chat, mode, {
      storage_error: chat.storageError,
      retrieval_queries: retrievalQueries,
      query_rewrite: queryRewrite,
      rewrite_model: mode === "rag" ? rewriteModel : undefined,
    });
  } catch (error) {
    const payload: AskResponse = {
      answer: fallbackAnswer({
        question,
        mode,
        sources: localSources,
        needsApiKey: false,
        memoryError: loaded.memoryError,
      }),
      sources: localSources,
      mode,
      model,
      demo_mode: loaded.demoMode,
      schema_missing: loaded.schemaMissing,
      memory_error: loaded.memoryError,
      web_search_enabled: mode === "web",
      web_search_used: false,
      chat_id: chat.chatId,
      user_message_id: chat.userMessageId,
    };

    return responseWithStoredAssistant(
      {
        ...payload,
        answer: `${payload.answer}\n\n_${
          error instanceof Error ? error.message : "OpenAI request failed"
        }_`,
      },
      502,
      chat,
      mode,
      {
        storage_error: chat.storageError,
        retrieval_queries: retrievalQueries,
        query_rewrite: queryRewrite,
        rewrite_model: mode === "rag" ? rewriteModel : undefined,
      }
    );
  }
}