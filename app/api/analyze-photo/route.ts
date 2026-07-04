import OpenAI from "openai";
import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/supabaseClient";

export const runtime = "nodejs";

type AnalysisMode = "text" | "equation" | "diagram";

type PreviousDraft = {
  text?: string;
  latex?: string;
  diagram_summary?: string;
  figure_prompt?: string;
};

type MeetingContext = {
  title?: string;
  date?: string;
  project_tag?: string | null;
  agenda?: string | null;
  participants?: string[];
};

type NoteContext = {
  elapsed_seconds?: number;
  content: string;
};

type PhotoAnalysisResult = {
  text: string;
  latex: string;
  diagram_summary: string;
  figure_prompt: string;
};

function fmtElapsed(seconds?: number) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(sec).padStart(2, "0")}`;
}

function buildNotesContext(notes: NoteContext[]) {
  if (!notes.length) return "No human notes were provided.";

  return notes
    .map((note) => `[${fmtElapsed(note.elapsed_seconds)}] ${note.content}`)
    .join("\n");
}

function extractOutputText(response: any) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks: string[] = [];

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function parseJsonOutput(outputText: string): PhotoAnalysisResult {
  const cleaned = outputText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as PhotoAnalysisResult;
}

function buildPrompt(args: {
  mode: AnalysisMode;
  meeting?: MeetingContext;
  notes?: NoteContext[];
  transcriptContext?: string;
  feedback?: string;
  previousDraft?: PreviousDraft;
}) {
  const { mode, meeting, notes, transcriptContext, feedback, previousDraft } =
    args;

  const modeInstruction =
    mode === "text"
      ? [
          "Extract plain visible text from the image.",
          "Preserve visible Korean text naturally.",
          "Preserve technical terms, model names, paper names, benchmark names, and code symbols in English when appropriate.",
          "Keep line breaks when they reflect the board layout.",
        ].join("\n")
      : mode === "equation"
        ? [
            "Extract visible mathematical equations and convert them to Notion equation-block compatible KaTeX.",
            "Return raw LaTeX content only in the latex field.",
            "Do not include Markdown math delimiters such as \\[ \\], $$ $$, or \\( \\).",
            "If there are multiple equations or one multi-line derivation, combine them into one complete LaTeX block using \\begin{aligned} ... \\end{aligned}.",
            "Do not wrap each line with separate math delimiters.",
            "If using \\begin{aligned}, include both \\begin{aligned} and \\end{aligned} in the same latex field.",
            "Use line breaks with \\\\ inside aligned blocks.",
            "Avoid TeX quote syntax such as ``text''. Use plain text inside \\text{...}.",
            "If a symbol, subscript, superscript, or operator is unclear, mark only that local part as \\text{[unclear]}.",
          ].join("\n")
        : [
            "Describe the visible diagram structure.",
            "Focus on nodes, arrows, labels, grouping, order, and flow.",
            "Do not turn the diagram into a broad summary; describe the visual structure.",
            "",
            "Also write a text-only image generation prompt for recreating the diagram as a clean academic figure.",
            "The figure prompt should be suitable for a text-to-image model.",
            "The generated figure should be a clean 2D academic diagram on a white background.",
            "Prefer simple boxes, arrows, labels, and minimal colors.",
            "Avoid photorealistic style, 3D rendering, decorative icons, hand-drawn style, and unnecessary background objects.",
            "Use concise English labels. If the exact label is unclear, use a generic placeholder label such as [unclear].",
          ].join("\n");

  return [
    "You are analyzing a board/photo captured during a research meeting.",
    "",
    "Selected analysis mode:",
    mode,
    "",
    "Task:",
    modeInstruction,
    "",
    "Rules:",
    "- Do not invent unreadable content.",
    "- If content is unclear, write [unclear] or \\text{[unclear]} depending on the output field.",
    "- Use meeting notes and transcript context only as correction hints.",
    "- Do not add claims that are not visually supported by the image.",
    "- Fill only the fields relevant to the selected mode; use empty strings for irrelevant fields.",
    "- For text mode, fill text.",
    "- For equation mode, fill latex.",
    "- For diagram mode, fill diagram_summary and figure_prompt.",
    "- For equation mode, the latex field must be directly pasteable into a Notion equation block.",
    "- Return valid JSON only.",
    "- Do not wrap the JSON in markdown fences.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        text: mode === "text" ? "plain visible text" : "",
        latex: mode === "equation" ? "Notion-compatible raw KaTeX" : "",
        diagram_summary:
          mode === "diagram" ? "diagram structure summary" : "",
        figure_prompt:
          mode === "diagram"
            ? "text-only image generation prompt for a clean academic diagram"
            : "",
      },
      null,
      2
    ),
    "",
    "Meeting metadata:",
    JSON.stringify(
      {
        title: meeting?.title ?? "",
        date: meeting?.date ?? "",
        project_tag: meeting?.project_tag ?? "",
        agenda: meeting?.agenda ?? "",
        participants: meeting?.participants ?? [],
      },
      null,
      2
    ),
    "",
    "Human notes:",
    buildNotesContext((notes ?? []) as NoteContext[]),
    "",
    "Transcript context:",
    transcriptContext?.trim() || "No transcript context provided.",
    "",
    previousDraft
      ? [
          "Previous draft:",
          JSON.stringify(previousDraft, null, 2),
          "",
          "User correction feedback:",
          feedback?.trim() || "No feedback provided.",
          "",
          "Revise the previous draft using the feedback, while still checking the image.",
        ].join("\n")
      : "",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const {
      storagePath,
      mode,
      meeting,
      notes,
      transcriptContext,
      feedback,
      previousDraft,
    } = await req.json();

    if (!storagePath || typeof storagePath !== "string") {
      return NextResponse.json(
        { error: "storagePath is required" },
        { status: 400 }
      );
    }

    if (!["text", "equation", "diagram"].includes(mode)) {
      return NextResponse.json(
        { error: "valid analysis mode is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const analysisMode = mode as AnalysisMode;
    const imageUrl = publicUrl(storagePath);

    if (!imageUrl) {
      return NextResponse.json(
        { error: "failed to resolve image url" },
        { status: 400 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = buildPrompt({
      mode: analysisMode,
      meeting,
      notes,
      transcriptContext,
      feedback,
      previousDraft,
    });

    console.log("[analyze-photo] mode:", analysisMode);
    console.log("[analyze-photo] storagePath:", storagePath);

    const response = await openai.responses.create({
      model: process.env.OPENAI_OCR_MODEL ?? "gpt-5.5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "photo_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              latex: { type: "string" },
              diagram_summary: { type: "string" },
              figure_prompt: { type: "string" },
            },
            required: [
              "text",
              "latex",
              "diagram_summary",
              "figure_prompt",
            ],
          },
        },
      },
    } as any);

    const outputText = extractOutputText(response);

    let result: PhotoAnalysisResult;

    try {
      result = parseJsonOutput(outputText);
    } catch {
      console.error("[analyze-photo] failed to parse model output:", outputText);

      return NextResponse.json(
        {
          error: "failed to parse model output",
          detail: outputText,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      provider: `openai:${process.env.OPENAI_OCR_MODEL ?? "gpt-5.5"}`,
      mode: analysisMode,
      result,
    });
  } catch (err: any) {
    console.error("[analyze-photo] failed", err);

    return NextResponse.json(
      {
        error: "photo analysis failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}