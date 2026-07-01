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