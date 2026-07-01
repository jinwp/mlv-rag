import OpenAI from "openai";
import { NextResponse } from "next/server";
import { MEDIA_BUCKET, publicUrl, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: Request) {
  try {
    const { photoId, meetingId, figurePrompt } = await req.json();

    if (!photoId || typeof photoId !== "string") {
      return NextResponse.json(
        { error: "photoId is required" },
        { status: 400 }
      );
    }

    if (!meetingId || typeof meetingId !== "string") {
      return NextResponse.json(
        { error: "meetingId is required" },
        { status: 400 }
      );
    }

    if (!figurePrompt || typeof figurePrompt !== "string") {
      return NextResponse.json(
        { error: "figurePrompt is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

    const prompt = [
      figurePrompt.trim(),
      "",
      "Rendering constraints:",
      "- Create a clean academic figure.",
      "- White background.",
      "- 2D diagram style.",
      "- Clear boxes, arrows, and labels.",
      "- Minimal color palette.",
      "- No photorealistic scene.",
      "- No decorative background.",
      "- No people, no hands, no whiteboard frame.",
      "- Avoid tiny unreadable text.",
    ].join("\n");

    console.log("[generate-figure] model:", model);
    console.log("[generate-figure] photoId:", photoId);

    const result = await openai.images.generate({
      model,
      prompt,
      size: "1536x1024",
      quality: "low",
    } as any);

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      console.error("[generate-figure] no b64_json:", result);

      return NextResponse.json(
        {
          error: "image generation returned no image data",
          detail: result,
        },
        { status: 500 }
      );
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");

    const timestamp = Date.now();
    const safePhotoId = safePathPart(photoId);
    const generatedPath = `${meetingId}/generated/${timestamp}-${safePhotoId}.png`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(generatedPath, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const now = new Date().toISOString();
    const provider = `openai:${model}`;

    const { error: updateError } = await supabase
      .from("photos")
      .update({
        figure_prompt: figurePrompt,
        generated_figure_path: generatedPath,
        figure_provider: provider,
        figure_generated_at: now,
      })
      .eq("id", photoId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      provider,
      generated_figure_path: generatedPath,
      generated_figure_url: publicUrl(generatedPath),
      figure_generated_at: now,
    });
  } catch (err: any) {
    console.error("[generate-figure] failed", err);

    return NextResponse.json(
      {
        error: "figure generation failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}