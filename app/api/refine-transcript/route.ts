import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

function fmtElapsed(seconds?: number) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function buildNotesContext(notes: NoteContext[]) {
  if (!notes.length) return "No human notes were provided.";

  return notes
    .map((note) => {
      const t = fmtElapsed(note.elapsed_seconds);
      return `[${t}] ${note.content}`;
    })
    .join("\n");
}

function buildMeetingContext(meeting: MeetingContext) {
  return [
    `Title: ${meeting.title ?? "Untitled meeting"}`,
    `Date: ${meeting.date ?? "Unknown"}`,
    `Project tag: ${meeting.project_tag ?? "None"}`,
    `Participants: ${(meeting.participants ?? []).join(", ") || "Unknown"}`,
    `Agenda: ${meeting.agenda ?? "None"}`,
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const { rawText, meeting, notes } = await req.json();

    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "rawText is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const meetingContext = buildMeetingContext(meeting ?? {});
    const notesContext = buildNotesContext((notes ?? []) as NoteContext[]);

    const contextSummary = [
      "Meeting metadata:",
      meetingContext,
      "",
      "Human notes:",
      notesContext,
    ].join("\n");

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_REWRITE_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: [
            "You correct raw Korean ASR transcripts from research meetings.",
            "",
            "Your job is transcript correction, not summarization.",
            "",
            "Rules:",
            "- Preserve every timestamp exactly.",
            "- Preserve every speaker label exactly.",
            "- Preserve the original line structure as much as possible.",
            "- Do not add new claims from context.",
            "- Do not remove uncertain content.",
            "- Correct Korean ASR errors.",
            "- Normalize technical terms into English when strongly supported.",
            "- Use meeting notes only as correction hints.",
            "- If uncertain, keep the original phrase or mark it as [unclear].",
            "- Return only the corrected transcript text. No markdown fences.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "Context:",
            contextSummary,
            "",
            "Raw transcript:",
            rawText,
          ].join("\n"),
        },
      ],
    });

    const refinedText =
      completion.choices[0]?.message?.content?.trim() ?? rawText;

    return NextResponse.json({
      provider: `openai:${process.env.OPENAI_REWRITE_MODEL ?? "gpt-4o-mini"}`,
      refinedText,
      contextSummary,
    });
  } catch (err: any) {
    console.error("[refine-transcript] failed", err);

    return NextResponse.json(
      {
        error: "transcript refinement failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}