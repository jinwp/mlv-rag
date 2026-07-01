export const MEMORY_KINDS = [
  "meeting_meta",
  "raw_transcript",
  "note",
  "board_capture",
  "decision",
  "todo",
  "open_question",
  "summary",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const SOURCE_TYPES = [
  "meeting",
  "transcript",
  "note",
  "photo",
  "board",
  "extraction",
] as const;

export type MemorySourceType = (typeof SOURCE_TYPES)[number];

export type MemoryChunkInput = {
  meeting_id: string;
  source_type: MemorySourceType;
  source_id: string | null;
  chunk_index: number;
  memory_kind: MemoryKind;
  content: string;
  speaker?: string | null;
  start_seconds?: number | null;
  end_seconds?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  generated_by?: string;
};

export type MemoryChunkRow = MemoryChunkInput & {
  id: string;
  created_at?: string;
  updated_at?: string;
  meetings?: {
    title?: string | null;
    date?: string | null;
    project_tag?: string | null;
  } | null;
};

export type MemorySearchResult = MemoryChunkRow & {
  score: number;
  score_breakdown: {
    algorithm: string;
    bm25: number;
    char_ngram: number;
    phrase: number;
    field: number;
    intent: number;
    weights: {
      bm25: number;
      char_ngram: number;
      phrase: number;
      field: number;
      intent: number;
    };
  };
  highlights: string[];
  matched_terms: string[];
  meeting_title?: string | null;
  meeting_date?: string | null;
  project_tag?: string | null;
};

export type IndexMeetingRequest = {
  meetingId?: string;
  dryRun?: boolean;
};

export type RagSearchRequest = {
  question?: string;
  limit?: number;
  projectTag?: string;
  kinds?: MemoryKind[];
  sortBySimilarity?: boolean;
};

export type RagChatRole = "user" | "assistant";

export type RagChatMessage = {
  id: string;
  role: RagChatRole;
  content: string;
  createdAt?: string;
};

export type RagChatRequest = RagSearchRequest & {
  chatId?: string;
  messageId?: string;
  history?: RagChatMessage[];
};

export type RagChatResponse = {
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  answer: string;
  sources: MemorySearchResult[];
  model?: string | null;
  demo_mode?: boolean;
  needs_api_key?: boolean;
};
