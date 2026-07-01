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
};

/** Shape returned by /api/ask (mock RAG for now). */
export type AskSource = {
  text: string;
  reason: string;
  meeting_id: string;
  timestamp?: number; // elapsed seconds into the meeting, if known
};

export type AskResponse = {
  answer: string; // markdown
  sources: AskSource[];
};
