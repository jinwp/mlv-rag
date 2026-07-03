import { NextResponse } from "next/server";
import { MEDIA_BUCKET, publicUrl, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const meetingId = cleanText(form.get("meetingId"));
    const elapsedSeconds = cleanNumber(form.get("elapsedSeconds"));

    const extractedText = cleanText(form.get("extractedText"));
    const extractedLatex = cleanText(form.get("extractedLatex"));
    const diagramSummary = cleanText(form.get("diagramSummary"));
    const figurePrompt = cleanText(form.get("figurePrompt"));
    const provider = cleanText(form.get("provider"));

    const file = form.get("file");

    if (!meetingId) {
      return jsonError("meetingId is required");
    }

    if (!(file instanceof File)) {
      return jsonError("file is required");
    }

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id,title")
      .eq("id", meetingId)
      .maybeSingle();

    if (meetingError) throw meetingError;

    if (!meeting) {
      return jsonError("meeting not found", 404);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const originalName = file.name || "fast-ocr-image.png";
    const extension =
      originalName.includes(".")
        ? originalName.split(".").pop()?.toLowerCase() || "png"
        : "png";

    const timestamp = Date.now();
    const safeName = safePathPart(originalName.replace(/\.[^.]+$/, "")) || "fast-ocr";
    const storagePath = `${meetingId}/photos/${timestamp}-${safeName}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || "image/png",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const now = new Date().toISOString();

    const { data: photo, error: insertError } = await supabase
      .from("photos")
      .insert({
        meeting_id: meetingId,
        storage_path: storagePath,
        elapsed_seconds: elapsedSeconds,
        extracted_text: extractedText || null,
        extracted_latex: extractedLatex || null,
        diagram_summary: diagramSummary || null,
        figure_prompt: figurePrompt || null,
        // analysis_provider: provider || "fast-ocr",
        // analysis_generated_at: now,
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      photo,
      storage_path: storagePath,
      public_url: publicUrl(storagePath),
    });
  } catch (error: any) {
    console.error("[fast-ocr insert] failed", error);

    return jsonError(
      "failed to insert OCR result into meeting",
      500,
      error?.message ?? String(error)
    );
  }
}