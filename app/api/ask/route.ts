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
const MAX_LOCAL_SOURCES = 6;

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

function buildEvidenceBlock(results: MemorySearchResult[]): string {
  if (results.length === 0) return "No local meeting-memory evidence was retrieved.";

  return results
    .map((result, index) => {
      const label = memorySourceLabel(index);
      const title = result.meeting_title ?? result.meeting_id;
      const time = secondsLabel(result.start_seconds, result.end_seconds);
      return [
        `[${label}]`,
        `meeting: ${title}`,
        `date: ${result.meeting_date ?? "no-date"}`,
        `project: ${result.project_tag ?? "미분류"}`,
        `time: ${time}`,
        `kind: ${result.memory_kind}`,
        `similarity_score: ${result.score.toFixed(2)}`,
        `content: ${safeSnippet(result.content)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function extractOpenAIOutput(response: any): ExtractedOutput {
  const outputText = typeof response.output_text === "string" ? response.output_text.trim() : "";
  const fallbackTexts: string[] = [];
  const webSources: AskSource[] = [];
  let webSearchUsed = false;

  for (const item of response.output ?? []) {
    if (item?.type === "web_search_call") webSearchUsed = true;
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        fallbackTexts.push(content.text.trim());
      }
      for (const annotation of content?.annotations ?? []) {
        if (annotation?.type !== "url_citation" || !annotation.url) continue;
        if (webSources.some((existing) => existing.url === annotation.url)) continue;
        webSources.push({
          label: `웹 ${webSources.length + 1}`,
          type: "web",
          title: annotation.title || annotation.url,
          text: annotation.title || annotation.url,
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
  for (const source of sources.slice(0, 3)) {
    lines.push(`- ${source.label ?? "근거"}: ${source.reason}`);
    lines.push(`  ${source.text}`);
  }
  return lines.join("\n");
}

function buildDeveloperPrompt(mode: AskMode): string {
  if (mode === "rag") {
    return [
      "You are a Korean lab meeting search chatbot.",
      "Answer from local meeting-memory evidence only.",
      "Do not use outside knowledge for meeting decisions.",
      "If evidence is insufficient, say so.",
      "Use concise Markdown.",
      "When citing local meeting evidence, write labels like '(근거 1)' or '(근거 2)'; never use '[E1]' style labels.",
    ].join("\n");
  }

  if (mode === "web") {
    return [
      "You are a Korean web-search chatbot.",
      "Use the hosted web search tool for current or public information.",
      "Do not claim to know private lab meeting decisions unless the user provides them in the conversation.",
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

async function callOpenAI(params: {
  apiKey: string;
  model: string;
  mode: AskMode;
  question: string;
  localEvidence: string;
  history: AskHistoryMessage[];
  memoryError?: string;
}): Promise<ExtractedOutput> {
  const openai = new OpenAI({ apiKey: params.apiKey });
  const currentContent =
    params.mode === "rag"
      ? [
          `Question:\n${params.question}`,
          `Local meeting-memory evidence:\n${params.localEvidence}`,
          params.memoryError ? `Memory DB warning:\n${params.memoryError}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : params.question;

  const response = await openai.responses.create({
    model: params.model,
    max_output_tokens: 1000,
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
  } as any);

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
  const loaded = mode === "rag" ? await loadMemoryChunks() : { chunks: [], demoMode: false };
  const results =
    mode === "rag"
      ? rankMemoryChunks(question, loaded.chunks, {
          limit: MAX_LOCAL_SOURCES,
          sortBySimilarity: true,
        })
      : [];
  const localSources = toAskSources(results);
  const chat = await ensureChatStorage({
    requestedChatId: body.chatId,
    question,
    mode,
    history,
  });
  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    mode === "web"
      ? process.env.OPENAI_WEB_SEARCH_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
      : process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

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
    return responseWithStoredAssistant(payload, 200, chat, mode, { needs_api_key: true, storage_error: chat.storageError });
  }

  try {
    const output = await callOpenAI({
      apiKey,
      model,
      mode,
      question,
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
    return responseWithStoredAssistant(payload, 200, chat, mode, { storage_error: chat.storageError });
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
        answer: `${payload.answer}\n\n_${error instanceof Error ? error.message : "OpenAI request failed"}_`,
      },
      502,
      chat,
      mode,
      { storage_error: chat.storageError }
    );
  }
}
