import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

function cleanJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function fileToDataUrl(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mime = file.type || "image/png";
  return `data:${mime};base64,${base64}`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("file is required");
    }

    if (!process.env.OPENAI_API_KEY) {
      return jsonError("OPENAI_API_KEY is missing", 500);
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const model = process.env.OPENAI_VISION_MODEL ?? "gpt-5.5";
    const imageUrl = await fileToDataUrl(file);

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You extract board, slide, paper, and diagram content from meeting photos.",
            "Return strict JSON only.",
            "Do not hallucinate text that is not visible.",
            "Preserve technical terms, equations, arrows, labels, and layout semantics.",
            "If handwriting or text is unclear, mark it as unclear instead of guessing.",
            "For equations, provide LaTeX when possible.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Analyze this image for fast OCR before inserting it into a meeting archive.",
                "",
                "Return JSON with exactly these fields:",
                "{",
                '  "extracted_text": "visible plain text OCR, preserving line breaks",',
                '  "extracted_latex": "visible equations in LaTeX, or empty string",',
                '  "diagram_summary": "concise description of diagram/board structure",',
                '  "figure_prompt": "clean academic figure-generation prompt based on the visible diagram, or empty string"',
                "}",
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(cleanJsonText(raw));
    } catch {
      return jsonError("OCR model returned invalid JSON", 500, raw);
    }

    return NextResponse.json({
      provider: `openai:${model}`,
      extracted_text: safeString(parsed.extracted_text),
      extracted_latex: safeString(parsed.extracted_latex),
      diagram_summary: safeString(parsed.diagram_summary),
      figure_prompt: safeString(parsed.figure_prompt),
    });
  } catch (error: any) {
    console.error("[fast-ocr] failed", error);

    return jsonError(
      "fast OCR failed",
      500,
      error?.message ?? String(error)
    );
  }
}