import OpenAI from "openai";
import { NextResponse } from "next/server";
import { MEDIA_BUCKET, publicUrl, supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: Request) {
  try {
    const { figurePrompt } = await req.json();

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
      "- Use the background specified in the figure prompt. If no background is specified, use a white background.",
      "- 2D diagram style.",
      "- Clear boxes, arrows, and labels.",
      "- Minimal color palette.",
      "- No photorealistic scene.",
      "- No decorative background unless explicitly requested by the figure prompt.",
      "- No people, no hands, no whiteboard frame.",
      "- Avoid tiny unreadable text.",
    ].join("\n");

    const result = await openai.images.generate({
      model,
      prompt,
      size: "1536x1024",
      quality: "low",
    } as any);

    const imageBase64 = result.data?.[0]?.b64_json;

    if (!imageBase64) {
      console.error("[fast-ocr/generate-figure] no b64_json:", result);

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
    const safeName = safePathPart("fast-ocr-figure");
    const generatedPath = `fast-ocr/generated/${timestamp}-${safeName}.png`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(generatedPath, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const provider = `openai:${model}`;

    return NextResponse.json({
      provider,
      generated_figure_path: generatedPath,
      generated_figure_url: publicUrl(generatedPath),
      figure_generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[fast-ocr/generate-figure] failed", err);

    return NextResponse.json(
      {
        error: "figure generation failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}