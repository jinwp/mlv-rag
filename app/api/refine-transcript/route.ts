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

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
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

function buildSpeakerMappingContext(speakerMapText: string) {
  const cleaned = speakerMapText.trim();

  if (!cleaned) {
    return [
      "No speaker mapping was provided.",
      "Keep speaker labels such as A:, B:, C: unchanged.",
    ].join("\n");
  }

  return [
    "Speaker mapping provided by the user:",
    cleaned,
    "",
    "The speaker mapping is binding.",
    "Replace mapped speaker labels exactly with the mapped names.",
    "Examples:",
    "- If the mapping says `A = 김현우 교수님`, then `[00:00:01 - 00:00:07] A: ...` must become `[00:00:01 - 00:00:07] 김현우 교수님: ...`.",
    "- If the mapping says `B = 서진우`, then `B:` must become `서진우:`.",
    "- If a speaker label is not mapped, keep the original label.",
    "",
    "Do not infer speaker identities beyond the provided mapping.",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const { rawText, meeting, notes, speakerMapText } = await req.json();

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
    const speakerMappingContext = buildSpeakerMappingContext(
      typeof speakerMapText === "string" ? speakerMapText : ""
    );

    const contextSummary = [
      "Meeting metadata:",
      meetingContext,
      "",
      "Speaker mapping:",
      speakerMappingContext,
      "",
      "Human notes:",
      notesContext,
    ].join("\n");

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const model = process.env.OPENAI_REWRITE_MODEL ?? "gpt-5.5";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You correct raw Korean ASR transcripts from research meetings.",
            "",
            "Your job is transcript correction, not summarization.",
            "",
            "Core rules:",
            "- Preserve every timestamp exactly.",
            "- Preserve the original line structure as much as possible.",
            "- Preserve all substantive content.",
            "- Do not add new claims from context.",
            "- Do not remove uncertain content.",
            "- Correct Korean ASR errors.",
            "- Normalize technical terms, paper names, benchmarks, method names, model names, and code symbols into English when strongly supported.",
            "- Use meeting notes only as correction hints.",
            "- If uncertain, keep the original phrase or mark it as [unclear].",
            "- Return only the corrected transcript text. No markdown fences.",
            "",
            "Speaker rules:",
            "- If a speaker mapping is provided, replace mapped labels such as A:, B:, C: with the mapped real names exactly.",
            "- Do not keep A:, B:, C: for mapped speakers.",
            "- If a speaker is not mapped, keep the original speaker label.",
            "- Do not guess speaker identities that are not provided in the mapping.",
            "- Preserve the timestamp format while changing only the speaker label and transcript text.",
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
      provider: `openai:${model}`,
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