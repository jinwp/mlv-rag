import { NextResponse } from "next/server";
import { MEDIA_BUCKET, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Category = "summary" | "audio" | "image" | "transcript" | "rag";

async function deleteStoragePaths(paths: string[]) {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  if (uniquePaths.length === 0) return { deleted: 0 };

  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(uniquePaths);
  if (error) throw error;

  return { deleted: uniquePaths.length };
}

async function deleteSummary(ids: string[], deleteAll: boolean) {
  if (deleteAll) {
    const { error } = await supabase
      .from("meetings")
      .update({
        summary_text: null,
        summary_generated_at: null,
        summary_model: null,
      })
      .not("summary_text", "is", null);

    if (error) throw error;
    return { deleted: "all" };
  }

  const { error } = await supabase
    .from("meetings")
    .update({
      summary_text: null,
      summary_generated_at: null,
      summary_model: null,
    })
    .in("id", ids);

  if (error) throw error;
  return { deleted: ids.length };
}

async function getAllAudioPaths() {
  const { data, error } = await supabase
    .from("transcripts")
    .select("audio_path")
    .not("audio_path", "is", null);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => row.audio_path)
    .filter((path: unknown): path is string => typeof path === "string" && path.trim())
    .map((path) => path.trim());
}

async function deleteAudio(ids: string[], deleteAll: boolean) {
  const paths = deleteAll ? await getAllAudioPaths() : ids;

  const result = await deleteStoragePaths(paths);

  if (paths.length > 0) {
    const { error } = await supabase
      .from("transcripts")
      .update({ audio_path: null })
      .in("audio_path", paths);

    if (error) throw error;
  }

  return result;
}

async function getAllImagePaths() {
  const { data, error } = await supabase
    .from("photos")
    .select("storage_path,generated_figure_path");

  if (error) throw error;

  const paths: string[] = [];

  for (const row of data ?? []) {
    const storagePath = (row as any).storage_path;
    const figurePath = (row as any).generated_figure_path;

    if (typeof storagePath === "string" && storagePath.trim()) {
      paths.push(storagePath.trim());
    }

    if (typeof figurePath === "string" && figurePath.trim()) {
      paths.push(figurePath.trim());
    }
  }

  return paths;
}

async function deleteImage(ids: string[], deleteAll: boolean) {
  const paths = deleteAll ? await getAllImagePaths() : ids;

  const result = await deleteStoragePaths(paths);

  if (paths.length > 0) {
    const { error: deletePhotoRowsError } = await supabase
      .from("photos")
      .delete()
      .in("storage_path", paths);

    if (deletePhotoRowsError) {
      console.warn(
        "[storage delete] failed to delete photo rows",
        deletePhotoRowsError.message
      );
    }

    const { error: clearFigureError } = await supabase
      .from("photos")
      .update({
        generated_figure_path: null,
        figure_provider: null,
        figure_generated_at: null,
      })
      .in("generated_figure_path", paths);

    if (clearFigureError) {
      console.warn(
        "[storage delete] failed to clear generated figure refs",
        clearFigureError.message
      );
    }
  }

  return result;
}

async function deleteTranscripts(ids: string[], deleteAll: boolean) {
  if (deleteAll) {
    const { error } = await supabase.from("transcripts").delete().not("id", "is", null);
    if (error) throw error;
    return { deleted: "all" };
  }

  const { error } = await supabase.from("transcripts").delete().in("id", ids);
  if (error) throw error;

  return { deleted: ids.length };
}

async function deleteRagChunks(ids: string[], deleteAll: boolean) {
  if (deleteAll) {
    const { error } = await supabase
      .from("meeting_memory_chunks")
      .delete()
      .not("id", "is", null);

    if (error) throw error;
    return { deleted: "all" };
  }

  const { error } = await supabase
    .from("meeting_memory_chunks")
    .delete()
    .in("id", ids);

  if (error) throw error;
  return { deleted: ids.length };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const category = body.category as Category | undefined;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    const deleteAll = Boolean(body.deleteAll);

    if (!category) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 }
      );
    }

    if (!deleteAll && ids.length === 0) {
      return NextResponse.json(
        { error: "ids are required unless deleteAll=true" },
        { status: 400 }
      );
    }

    let result: unknown;

    if (category === "summary") {
      result = await deleteSummary(ids, deleteAll);
    } else if (category === "audio") {
      result = await deleteAudio(ids, deleteAll);
    } else if (category === "image") {
      result = await deleteImage(ids, deleteAll);
    } else if (category === "transcript") {
      result = await deleteTranscripts(ids, deleteAll);
    } else if (category === "rag") {
      result = await deleteRagChunks(ids, deleteAll);
    } else {
      return NextResponse.json(
        { error: `unsupported category: ${category}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[storage delete] failed", error);

    return NextResponse.json(
      {
        error: "failed to delete storage items",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}