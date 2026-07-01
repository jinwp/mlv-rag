import { getDummyChunks } from "@/lib/rag/fixtures";
import type { MemoryChunkRow } from "@/lib/rag/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export const MEMORY_CHUNK_SELECT =
  "id, meeting_id, source_type, source_id, chunk_index, memory_kind, content, speaker, start_seconds, end_seconds, tags, metadata, generated_by, created_at, meetings(title,date,project_tag)";

export type MemoryLoadResult = {
  chunks: MemoryChunkRow[];
  demoMode: boolean;
  memoryError?: string;
  schemaMissing?: boolean;
};

export function isMissingRagSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("meeting_memory_chunks") &&
    (lower.includes("could not find the table") ||
      lower.includes("schema cache") ||
      lower.includes("pgrst205"))
  );
}

export async function loadMemoryChunks(): Promise<MemoryLoadResult> {
  if (!isSupabaseConfigured) {
    return {
      chunks: getDummyChunks(),
      demoMode: true,
      memoryError: "Supabase env vars are missing. Using built-in demo memory.",
    };
  }

  const { data, error } = await supabase
    .from("meeting_memory_chunks")
    .select(MEMORY_CHUNK_SELECT)
    .order("created_at", { ascending: false })
    .limit(1000)
    .returns<MemoryChunkRow[]>();

  if (!error) return { chunks: data ?? [], demoMode: false };

  if (isMissingRagSchemaError(error.message)) {
    return {
      chunks: getDummyChunks(),
      demoMode: true,
      schemaMissing: true,
      memoryError:
        "Supabase RAG schema is not applied yet. Using built-in demo memory. Run supabase-rag-schema.sql for real DB search.",
    };
  }

  return { chunks: [], demoMode: false, memoryError: error.message };
}
