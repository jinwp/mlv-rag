import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  formatNotionContextsForPrompt,
  loadSelectedNotionPageContexts,
} from "@/lib/notion/context";
import { syncNotionSlideChunksForMeeting } from "@/lib/memory/notionSlideChunks";

export const runtime = "nodejs";

type MeetingContext = {
  id?: string;
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

type NotionSlidePathMap = Record<string, string>;

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

function normalizeNotionSlidePageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value.filter(
        (pageId: unknown): pageId is string =>
          typeof pageId === "string" && pageId.trim().length > 0
      )
    ),
  ];
}

function normalizeNotionSlidePathMap(value: unknown): NotionSlidePathMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, val]) =>
      typeof key === "string" &&
      key.trim().length > 0 &&
      typeof val === "string" &&
      val.trim().length > 0
  );

  return Object.fromEntries(entries) as NotionSlidePathMap;
}

function buildNotionContextInstruction(hasContext: boolean) {
  if (!hasContext) return "";

  return [
    "[How to Use Selected Notion Slide Context]",
    "Use the selected Notion slide pages only as background context.",
    "The current raw transcript is the primary source of truth.",
    "Use the slide context to normalize terminology, project names, method names, benchmark names, experiment labels, and research framing.",
    "Do not add claims that are only present in the slide context unless they are clearly relevant to correcting the transcript.",
    "Do not summarize the slide context.",
    "Do not rewrite the transcript into slide style.",
    "Do not remove transcript content just because it is absent from the slide context.",
  ].join("\n");
}

function buildRefinementContextPayload(args: {
  notionSlidePageIds: string[];
  notionSlidePathMap: NotionSlidePathMap;
  notionContextCount: number;
  speakerMapProvided: boolean;
  notesCount: number;
  slideChunkSync: {
    deletedExisting: boolean;
    insertedChunks: number;
    sourceCount: number;
  };
}) {
  return {
    context_policy: "read_from_notion_at_rewrite_time",
    speaker_map_provided: args.speakerMapProvided,
    notes_count: args.notesCount,
    notion_context_count: args.notionContextCount,
    notion_slide_chunk_sync: args.slideChunkSync,
    notion_slides: args.notionSlidePageIds.map((pageId) => ({
      pageId,
      path: args.notionSlidePathMap[pageId] ?? null,
    })),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      meetingId: rawMeetingId,
      rawText: rawRawText,
      meeting,
      notes,
      speakerMapText,
      notionSlidePageIds: rawNotionSlidePageIds,
      notionSlidePathMap: rawNotionSlidePathMap,
    } = body;

    const rawText = typeof rawRawText === "string" ? rawRawText : "";
    const hasRawText = rawText.trim().length > 0;

    const notionSlidePageIds = normalizeNotionSlidePageIds(
      rawNotionSlidePageIds
    );
    const notionSlidePathMap = normalizeNotionSlidePathMap(
      rawNotionSlidePathMap
    );

    const meetingObj = (meeting ?? {}) as MeetingContext;
    const meetingId =
      typeof rawMeetingId === "string" && rawMeetingId.trim().length > 0
        ? rawMeetingId.trim()
        : typeof meetingObj.id === "string"
        ? meetingObj.id
        : "";

    if (!hasRawText && notionSlidePageIds.length === 0) {
      return NextResponse.json(
        { error: "Either rawText or notionSlidePageIds is required" },
        { status: 400 }
      );
    }

    if (!meetingId && notionSlidePageIds.length > 0) {
      return NextResponse.json(
        { error: "meetingId is required to sync Notion slide chunks" },
        { status: 400 }
      );
    }

    const notionContexts =
      notionSlidePageIds.length > 0
        ? await loadSelectedNotionPageContexts(notionSlidePageIds, {
            pageIdToPath: notionSlidePathMap,
            maxCharsPerPage: 12000,
            maxDepth: 5,
          })
        : [];

    const slideChunkSync =
      meetingId.length > 0
        ? await syncNotionSlideChunksForMeeting({
            meetingId,
            contexts: notionContexts,
          })
        : {
            deletedExisting: false,
            insertedChunks: 0,
            sourceCount: 0,
          };

    const notionContextInstruction = buildNotionContextInstruction(
      notionContexts.length > 0
    );

    const notionSlideContextText =
      formatNotionContextsForPrompt(notionContexts);

    const noteContexts = Array.isArray(notes)
      ? ((notes ?? []) as NoteContext[])
      : [];

    const speakerMap =
      typeof speakerMapText === "string" ? speakerMapText : "";

    const meetingContext = buildMeetingContext(meetingObj);
    const notesContext = buildNotesContext(noteContexts);
    const speakerMappingContext = buildSpeakerMappingContext(speakerMap);

    const contextSummary = [
      "Meeting metadata:",
      meetingContext,
      "",
      "Speaker mapping:",
      speakerMappingContext,
      "",
      "Human notes:",
      notesContext,
      "",
      notionContexts.length > 0
        ? `Selected Notion slide contexts: ${notionContexts
            .map((context) => context.path)
            .join(" | ")}`
        : "Selected Notion slide contexts: None",
      "",
      `Notion slide chunks synced: ${slideChunkSync.insertedChunks}`,
    ].join("\n");

    const refinementContext = buildRefinementContextPayload({
      notionSlidePageIds,
      notionSlidePathMap,
      notionContextCount: notionContexts.length,
      speakerMapProvided: speakerMap.trim().length > 0,
      notesCount: noteContexts.length,
      slideChunkSync,
    });

    if (!hasRawText) {
      return NextResponse.json({
        mode: "chunk_only",
        provider: null,
        refinedText: null,
        contextSummary,
        refinementContext,
        slideChunkSync,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const userPrompt = [
      notionContextInstruction,
      notionSlideContextText,
      "",
      "[Current Transcript Rewrite Task]",
      "",
      "Context:",
      contextSummary,
      "",
      "Raw transcript:",
      rawText,
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n");

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
            "- Use meeting notes and selected Notion slide context only as correction hints.",
            "- If uncertain, keep the original phrase or mark it as [unclear].",
            "- Return only the corrected transcript text. No markdown fences.",
            "",
            "Speaker rules:",
            "- If a speaker mapping is provided, replace mapped labels such as A:, B:, C: with the mapped real names exactly.",
            "- Do not keep A:, B:, C: for mapped speakers.",
            "- If a speaker is not mapped, keep the original speaker label.",
            "- Do not guess speaker identities that are not provided in the mapping.",
            "- Preserve the timestamp format while changing only the speaker label and transcript text.",
            "",
            "Notion slide context rules:",
            "- Treat selected Notion slide pages as user-editable background context.",
            "- Use them to correct terminology and align research framing.",
            "- Do not import unrelated slide content into the transcript.",
            "- Do not summarize or restructure the transcript as slides.",
          ].join("\n"),
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const refinedText =
      completion.choices[0]?.message?.content?.trim() ?? rawText;

    return NextResponse.json({
      mode: "rewrite",
      provider: `openai:${model}`,
      refinedText,
      contextSummary,
      refinementContext,
      slideChunkSync,
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