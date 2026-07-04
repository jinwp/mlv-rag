import { supabase } from "@/lib/supabaseClient";

export type NotionPageContextForChunks = {
  pageId: string;
  title: string;
  path: string;
  url: string | null;
  lastEditedTime: string | null;
  text: string;
};

const NOTION_SLIDE_SOURCE_TYPE = "photo";
const NOTION_SLIDE_MEMORY_KIND = "board_capture";
const NOTION_SLIDE_GENERATED_BY = "notion_slide_context_sync";

function chunkText(text: string, maxChars = 1600, overlap = 180): string[] {
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!cleaned) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + maxChars, cleaned.length);
    const chunk = cleaned.slice(start, end).trim();

    if (chunk) chunks.push(chunk);

    if (end >= cleaned.length) break;

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

export async function syncNotionSlideChunksForMeeting(args: {
  meetingId: string;
  contexts: NotionPageContextForChunks[];
}) {
  const meetingId = args.meetingId.trim();

  if (!meetingId) {
    return {
      deletedExisting: false,
      insertedChunks: 0,
      sourceCount: 0,
    };
  }

  const { error: deleteError } = await supabase
    .from("meeting_memory_chunks")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("source_type", NOTION_SLIDE_SOURCE_TYPE)
    .eq("generated_by", NOTION_SLIDE_GENERATED_BY);

  if (deleteError) throw deleteError;

  const contexts = args.contexts.filter((context) => context.text.trim());

  const rows = contexts.flatMap((context) =>
    chunkText(context.text).map((content, chunkIndex) => ({
      meeting_id: meetingId,
      source_type: NOTION_SLIDE_SOURCE_TYPE,
      source_id: context.pageId,
      chunk_index: chunkIndex,
      memory_kind: NOTION_SLIDE_MEMORY_KIND,
      content,
      tags: ["notion", "slide"],
      metadata: {
        virtualSourceType: "notion_slide",
        title: context.title,
        path: context.path,
        url: context.url,
        lastEditedTime: context.lastEditedTime,
      },
      generated_by: NOTION_SLIDE_GENERATED_BY,
    }))
  );

  if (rows.length === 0) {
    return {
      deletedExisting: true,
      insertedChunks: 0,
      sourceCount: contexts.length,
    };
  }

  const { error: insertError } = await supabase
    .from("meeting_memory_chunks")
    .insert(rows);

  if (insertError) throw insertError;

  return {
    deletedExisting: true,
    insertedChunks: rows.length,
    sourceCount: contexts.length,
  };
}