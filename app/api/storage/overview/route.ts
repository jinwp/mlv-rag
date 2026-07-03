import { NextResponse } from "next/server";
import { MEDIA_BUCKET, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Category = "summary" | "audio" | "image" | "transcript" | "rag";

type Item = {
  id: string;
  category: Category;
  source: "storage" | "db";
  name: string;
  path: string | null;
  sizeBytes: number;
  updatedAt: string | null;
  detail: string;
};

function byteLength(value: unknown): number {
  if (value == null) return 0;
  return new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value)
  ).length;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function parentPrefix(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function sizeFromMetadata(metadata: unknown): number {
  const meta = metadata as Record<string, unknown> | null | undefined;
  const raw = meta?.size ?? meta?.contentLength ?? meta?.content_length;

  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw) || 0;

  return 0;
}

async function getStorageObjectMeta(path: string): Promise<{
  sizeBytes: number;
  updatedAt: string | null;
}> {
  const prefix = parentPrefix(path);
  const name = fileName(path);

  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "updated_at", order: "desc" },
  });

  if (error) {
    console.warn("[storage overview] failed to list prefix", prefix, error.message);
    return { sizeBytes: 0, updatedAt: null };
  }

  const entry = (data ?? []).find((item) => item.name === name);

  return {
    sizeBytes: sizeFromMetadata(entry?.metadata),
    updatedAt: entry?.updated_at ?? entry?.created_at ?? null,
  };
}

async function loadSummaryItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("meetings")
    .select("id,title,date,created_at,summary_text,summary_generated_at,summary_model")
    .not("summary_text", "is", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => {
      const sizeBytes = byteLength(row.summary_text);

      return {
        id: row.id,
        category: "summary" as const,
        source: "db" as const,
        name: row.title || `meeting_${row.id}`,
        path: null,
        sizeBytes,
        updatedAt: row.summary_generated_at ?? row.created_at ?? null,
        detail: row.date
          ? `meeting summary · ${row.date}`
          : "meeting summary",
      };
    })
    .filter((item) => item.sizeBytes > 0);
}

async function loadAudioItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("transcripts")
    .select("id,meeting_id,audio_path,created_at")
    .not("audio_path", "is", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []).filter(
    (row: any) => typeof row.audio_path === "string" && row.audio_path.trim()
  );

  return Promise.all(
    rows.map(async (row: any) => {
      const path = row.audio_path.trim();
      const meta = await getStorageObjectMeta(path);

      return {
        id: path,
        category: "audio" as const,
        source: "storage" as const,
        name: fileName(path),
        path,
        sizeBytes: meta.sizeBytes,
        updatedAt: meta.updatedAt ?? row.created_at ?? null,
        detail: row.meeting_id
          ? `transcripts.audio_path · meeting_id: ${row.meeting_id}`
          : "transcripts.audio_path",
      };
    })
  );
}

async function loadImageItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id,meeting_id,storage_path,generated_figure_path,created_at,analyzed_at,figure_generated_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const pathEntries: {
    id: string;
    meetingId: string | null;
    path: string;
    kind: "photo" | "generated_figure";
    fallbackUpdatedAt: string | null;
  }[] = [];

  for (const row of data ?? []) {
    const photoPath = (row as any).storage_path;
    const figurePath = (row as any).generated_figure_path;

    if (typeof photoPath === "string" && photoPath.trim()) {
      pathEntries.push({
        id: `${(row as any).id}:storage_path`,
        meetingId: (row as any).meeting_id ?? null,
        path: photoPath.trim(),
        kind: "photo",
        fallbackUpdatedAt: (row as any).analyzed_at ?? (row as any).created_at ?? null,
      });
    }

    if (typeof figurePath === "string" && figurePath.trim()) {
      pathEntries.push({
        id: `${(row as any).id}:generated_figure_path`,
        meetingId: (row as any).meeting_id ?? null,
        path: figurePath.trim(),
        kind: "generated_figure",
        fallbackUpdatedAt:
          (row as any).figure_generated_at ??
          (row as any).analyzed_at ??
          (row as any).created_at ??
          null,
      });
    }
  }

  return Promise.all(
    pathEntries.map(async (entry) => {
      const meta = await getStorageObjectMeta(entry.path);

      return {
        id: entry.path,
        category: "image" as const,
        source: "storage" as const,
        name: fileName(entry.path),
        path: entry.path,
        sizeBytes: meta.sizeBytes,
        updatedAt: meta.updatedAt ?? entry.fallbackUpdatedAt,
        detail: entry.meetingId
          ? `${entry.kind} · meeting_id: ${entry.meetingId}`
          : entry.kind,
      };
    })
  );
}

async function loadTranscriptItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("transcripts")
    .select("id,meeting_id,full_text,refined_text,audio_path,created_at,refined_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => {
      const sizeBytes = byteLength(row.full_text) + byteLength(row.refined_text);

      return {
        id: row.id,
        category: "transcript" as const,
        source: "db" as const,
        name: `transcript_${row.id}`,
        path: row.audio_path ?? null,
        sizeBytes,
        updatedAt: row.refined_at ?? row.created_at ?? null,
        detail: row.meeting_id
          ? `meeting_id: ${row.meeting_id}`
          : "transcript row",
      };
    })
    .filter((item) => item.sizeBytes > 0);
}

async function loadRagItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("meeting_memory_chunks")
    .select(
      "id,meeting_id,source_type,source_id,chunk_index,memory_kind,content,tags,metadata,generated_by,created_at,updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const sizeBytes =
      byteLength(row.content) + byteLength(row.tags) + byteLength(row.metadata);

    return {
      id: row.id,
      category: "rag" as const,
      source: "db" as const,
      name: `${row.memory_kind ?? "chunk"}_${row.id}`,
      path: null,
      sizeBytes,
      updatedAt: row.updated_at ?? row.created_at ?? null,
      detail: row.meeting_id
        ? `${row.source_type ?? "source"} · meeting_id: ${row.meeting_id}`
        : row.source_type ?? "rag chunk",
    };
  });
}

function summarize(category: Category, items: Item[]) {
  const categoryItems = items.filter((item) => item.category === category);
  const totalBytes = categoryItems.reduce((sum, item) => sum + item.sizeBytes, 0);

  return {
    category,
    count: categoryItems.length,
    totalBytes,
    items: categoryItems,
  };
}

export async function GET() {
  try {
    const [
      summaryItems,
      audioItems,
      imageItems,
      transcriptItems,
      ragItems,
    ] = await Promise.all([
      loadSummaryItems(),
      loadAudioItems(),
      loadImageItems(),
      loadTranscriptItems(),
      loadRagItems(),
    ]);

    const items: Item[] = [
      ...summaryItems,
      ...audioItems,
      ...imageItems,
      ...transcriptItems,
      ...ragItems,
    ];

    const categories: Category[] = [
      "summary",
      "audio",
      "image",
      "transcript",
      "rag",
    ];

    const groups = categories.map((category) => summarize(category, items));
    const totalBytes = groups.reduce((sum, group) => sum + group.totalBytes, 0);

    return NextResponse.json({
      bucket: MEDIA_BUCKET,
      capacityLimitBytes: Number(process.env.STORAGE_LIMIT_MB ?? 500) * 1024 * 1024,
      totalBytes,
      groups,
    });
  } catch (error: any) {
    console.error("[storage overview] failed", error);

    return NextResponse.json(
      {
        error: "failed to load storage overview",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}