export type Meeting = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  participants: string[];
  project_tag: string | null;
  agenda: string | null;
  created_at: string;
};

export type Photo = {
  id: string;
  meeting_id: string;
  storage_path: string;
  elapsed_seconds: number;
  created_at: string;

  analysis_status?: string | null;
  analysis_modes?: string[] | null;
  extracted_text?: string | null;
  extracted_latex?: string | null;
  diagram_summary?: string | null;
  analysis_feedback?: string | null;
  analyzed_at?: string | null;

  figure_prompt?: string | null;
  generated_figure_path?: string | null;
  figure_provider?: string | null;
  figure_generated_at?: string | null;
};

export type Note = {
  id: string;
  meeting_id: string;
  content: string;
  elapsed_seconds: number;
  created_at: string;
};

export type Transcript = {
  id: string;
  meeting_id: string;
  full_text: string;
  audio_path: string | null;
  created_at: string;
  refined_text?: string | null;
  refinement_context?: string | null;
  refined_at?: string | null;
};

export type AskSourceType = "meeting" | "web";
export type AskMode = "rag" | "web" | "plain";

export type AskHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskSource = {
  label?: string;
  type?: AskSourceType;
  title?: string;
  text: string;
  reason: string;
  meeting_id?: string;
  timestamp?: number; // elapsed seconds into the meeting, if known
  url?: string;
  score?: number;
};

export type AskResponse = {
  answer: string; // markdown
  sources: AskSource[];
  mode?: AskMode;
  model?: string | null;
  demo_mode?: boolean;
  schema_missing?: boolean;
  memory_error?: string;
  needs_api_key?: boolean;
  web_search_enabled?: boolean;
  web_search_used?: boolean;
  chat_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
};

export type ChatSession = {
  id: string;
  title: string | null;
  mode: AskMode | null;
  created_at: string;
  updated_at?: string | null;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  mode?: AskMode | null;
  sources?: AskSource[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};
