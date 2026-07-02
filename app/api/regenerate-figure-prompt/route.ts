import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MeetingContext = {
  title?: string | null;
  date?: string | null;
  project_tag?: string | null;
  agenda?: string | null;
  participants?: string[] | null;
};

type NoteContext = {
  elapsed_seconds?: number | null;
  content?: string | null;
};

type RegenerateFigurePromptBody = {
  photoId?: string;
  currentFigurePrompt?: string;
  correctionNote?: string;
  diagramSummary?: string;
  extractedText?: string;
  extractedLatex?: string;
  meeting?: MeetingContext;
  notes?: NoteContext[];
  transcriptContext?: string;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function cleanText(value: unknown, maxChars = 12000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxChars);
}

function fmtElapsed(seconds?: number | null) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
}

function buildMeetingContext(meeting?: MeetingContext) {
  if (!meeting) return "No meeting metadata was provided.";

  return [
    `Title: ${meeting.title ?? "Untitled meeting"}`,
    `Date: ${meeting.date ?? "Unknown"}`,
    `Project tag: ${meeting.project_tag ?? "None"}`,
    `Participants: ${(meeting.participants ?? []).join(", ") || "Unknown"}`,
    `Agenda: ${meeting.agenda ?? "None"}`,
  ].join("\n");
}

function buildNotesContext(notes?: NoteContext[]) {
  const rows = (notes ?? [])
    .map((note) => {
      const content = cleanText(note.content, 600);
      if (!content) return "";
      return `[${fmtElapsed(note.elapsed_seconds)}] ${content}`;
    })
    .filter(Boolean);

  return rows.length ? rows.join("\n") : "No human notes were provided.";
}

function stripMarkdownFence(value: string) {
  return value
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegenerateFigurePromptBody;

    const currentFigurePrompt = cleanText(body.currentFigurePrompt, 8000);
    const correctionNote = cleanText(body.correctionNote, 4000);
    const diagramSummary = cleanText(body.diagramSummary, 6000);
    const extractedText = cleanText(body.extractedText, 4000);
    const extractedLatex = cleanText(body.extractedLatex, 4000);
    const transcriptContext = cleanText(body.transcriptContext, 8000);

    if (!correctionNote) {
      return jsonError("correctionNote is required");
    }

    if (!currentFigurePrompt && !diagramSummary) {
      return jsonError("currentFigurePrompt or diagramSummary is required");
    }

    if (!process.env.OPENAI_API_KEY) {
      return jsonError("OPENAI_API_KEY is missing", 500);
    }

    const model =
      process.env.OPENAI_REWRITE_MODEL ??
      process.env.OPENAI_SUMMARY_MODEL ??
      "gpt-5.5";

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You rewrite image-generation prompts for clean academic diagrams.",
            "You do not generate an image.",
            "You only return the revised image-generation prompt.",
            "The correction note is mandatory and overrides conflicting parts of the current prompt.",
            "Preserve useful structure, nodes, arrows, labels, and intended academic style from the current prompt.",
            "Apply requested text replacements exactly.",
            "If the correction note changes visual attributes such as background color, label names, arrows, layout, or emphasis, encode that change explicitly in the revised prompt.",
            "Remove or rewrite any old instruction that conflicts with the correction note.",
            "Do not include explanations, analysis, markdown fences, or bullet commentary outside the prompt itself.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "Meeting context:",
            buildMeetingContext(body.meeting),
            "",
            "Human notes:",
            buildNotesContext(body.notes),
            "",
            "Transcript context, optional:",
            transcriptContext || "No transcript context was provided.",
            "",
            "Extracted board/photo text, optional:",
            extractedText || "None.",
            "",
            "Extracted equation LaTeX, optional:",
            extractedLatex || "None.",
            "",
            "Diagram summary:",
            diagramSummary || "None.",
            "",
            "Current figure prompt:",
            currentFigurePrompt || "None.",
            "",
            "Correction note:",
            correctionNote,
            "",
            "Task:",
            "Rewrite the Current figure prompt into a final image-generation prompt after applying the Correction note.",
            "Return only the final prompt text.",
          ].join("\n"),
        },
      ],
    });

    const figurePrompt = stripMarkdownFence(
      completion.choices[0]?.message?.content ?? ""
    );

    if (!figurePrompt) {
      return jsonError("prompt regeneration returned an empty prompt", 500);
    }

    return NextResponse.json({
      provider: `openai:${model}`,
      figure_prompt: figurePrompt,
    });
  } catch (err: any) {
    console.error("[regenerate-figure-prompt] failed", err);

    return jsonError(
      "figure prompt regeneration failed",
      500,
      err?.message ?? String(err)
    );
  }
}