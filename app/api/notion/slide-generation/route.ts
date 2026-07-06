import OpenAI from "openai";
import { NextResponse } from "next/server";
import { publicUrl, supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import {
  formatNotionContextsForPrompt,
  loadSelectedNotionPageContexts,
} from "@/lib/notion/context";
import {
  appendBlocks,
  assertChildPageTitleAvailable,
  bulletBlock,
  createNotionPage,
  dividerBlock,
  equationBlock,
  heading1Block,
  heading2Block,
  heading3Block,
  imageBlock,
  paragraphBlock,
  toggleBlock,
  type NotionBlock,
} from "@/lib/notion/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  title?: string;
  instruction?: string;
  targetPageId?: string;
  meetingIds?: string[];
  assetIds?: string[];
  exampleSlidePageIds?: string[];
  exampleSlidePathMap?: Record<string, string>;
  freeformMaterial?: string;
};

type MemoryChunk = {
  id: string;
  meeting_id: string;
  source_type: string;
  memory_kind: string;
  content: string;
  tags?: string[] | null;
  metadata?: any;
  generated_by?: string | null;
};

type SlideAsset = {
  assetId: string;
  kind: "image" | "figure" | "equation";
  photoId: string;
  meetingId: string;
  title: string;
  url?: string;
  latex?: string;
  preview: string;
};

type SlidePlanBlock = {
  type:
    | "heading_1"
    | "heading_2"
    | "heading_3"
    | "paragraph"
    | "bullets"
    | "image"
    | "equation"
    | "divider"
    | "toggle";
  text?: string;
  title?: string;
  items?: string[];
  assetId?: string;
  caption?: string;
  latex?: string;
  children?: SlidePlanBlock[];
};

type SlidePlan = {
  title?: string;
  blocks?: SlidePlanBlock[];
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, val]) => [key, val])
  );
}

function cleanTitle(value: string) {
  return value
    .replace(/[\\/:*?"<>|#\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storageUrl(path?: string | null) {
  const cleaned = path?.trim();

  if (!cleaned) return "";

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  return publicUrl(cleaned);
}

function fmtElapsed(seconds?: number | null) {
  if (seconds == null) return "unknown";

  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
}

function normalizeLatexText(text?: string | null) {
  return (text ?? "")
    .replace(/```latex/gi, "")
    .replace(/```tex/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*\$\$\s*$/gm, "")
    .replace(/\$\$/g, "")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "")
    .trim();
}

function clip(text?: string | null, maxChars = 2200) {
  const cleaned = (text ?? "").replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length <= maxChars) return cleaned;

  return `${cleaned.slice(0, maxChars).trimEnd()}\n[truncated]`;
}

function extractJson(text: string): any {
  const cleaned = text.trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("model did not return JSON");
  }

  return JSON.parse(match[0]);
}

async function loadMeetingBundle(meetingIds: string[]) {
  if (meetingIds.length === 0) {
    return {
      meetings: [] as Meeting[],
      notes: [] as Note[],
      transcripts: [] as Transcript[],
      chunks: [] as MemoryChunk[],
    };
  }

  const [{ data: meetings }, { data: notes }, { data: transcripts }, { data: chunks }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("*")
        .in("id", meetingIds)
        .returns<Meeting[]>(),
      supabase
        .from("notes")
        .select("*")
        .in("meeting_id", meetingIds)
        .order("elapsed_seconds", { ascending: true })
        .returns<Note[]>(),
      supabase
        .from("transcripts")
        .select("*")
        .in("meeting_id", meetingIds)
        .order("created_at", { ascending: true })
        .returns<Transcript[]>(),
      supabase
        .from("meeting_memory_chunks")
        .select(
          [
            "id",
            "meeting_id",
            "source_type",
            "memory_kind",
            "content",
            "tags",
            "metadata",
            "generated_by",
          ].join(",")
        )
        .in("meeting_id", meetingIds)
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<MemoryChunk[]>(),
    ]);

  return {
    meetings: meetings ?? [],
    notes: notes ?? [],
    transcripts: transcripts ?? [],
    chunks: chunks ?? [],
  };
}

async function loadSelectedAssets(assetIds: string[]) {
  const photoIds = Array.from(
    new Set(
      assetIds
        .map((assetId) => assetId.split(":")[1])
        .filter((id): id is string => Boolean(id))
    )
  );

  if (photoIds.length === 0) return [];

  const { data: photos } = await supabase
    .from("photos")
    .select("*")
    .in("id", photoIds)
    .returns<Photo[]>();

  const photoMap = new Map((photos ?? []).map((photo) => [photo.id, photo]));
  const assets: SlideAsset[] = [];

  for (const assetId of assetIds) {
    const [kind, photoId] = assetId.split(":") as [
      "image" | "figure" | "equation",
      string
    ];

    const photo = photoMap.get(photoId);

    if (!photo) continue;

    const elapsed = fmtElapsed(photo.elapsed_seconds);

    if (kind === "figure") {
      const url = storageUrl(photo.generated_figure_path);

      if (!url) continue;

      assets.push({
        assetId,
        kind,
        photoId,
        meetingId: photo.meeting_id,
        title: `Generated figure · ${elapsed}`,
        url,
        preview:
          photo.figure_prompt?.trim() ||
          photo.diagram_summary?.trim() ||
          "Generated figure",
      });
    }

    if (kind === "image") {
      const url = storageUrl(photo.storage_path);

      if (!url) continue;

      assets.push({
        assetId,
        kind,
        photoId,
        meetingId: photo.meeting_id,
        title: `Original image · ${elapsed}`,
        url,
        preview:
          photo.diagram_summary?.trim() ||
          photo.extracted_text?.trim() ||
          "Original image",
      });
    }

    if (kind === "equation") {
      const latex = normalizeLatexText(photo.extracted_latex);

      if (!latex) continue;

      assets.push({
        assetId,
        kind,
        photoId,
        meetingId: photo.meeting_id,
        title: `Equation · ${elapsed}`,
        latex,
        preview: latex.slice(0, 900),
      });
    }
  }

  return assets;
}

function buildMeetingContext(args: {
  meetings: Meeting[];
  notes: Note[];
  transcripts: Transcript[];
  chunks: MemoryChunk[];
}) {
  const { meetings, notes, transcripts, chunks } = args;

  return meetings
    .map((meeting) => {
      const meetingNotes = notes.filter((note) => note.meeting_id === meeting.id);
      const meetingTranscripts = transcripts.filter(
        (transcript) => transcript.meeting_id === meeting.id
      );
      const meetingChunks = chunks.filter(
        (chunk) => chunk.meeting_id === meeting.id
      );

      const transcriptText = meetingTranscripts
        .map((transcript, index) => {
          const refined = transcript.refined_text?.trim();
          const raw = transcript.full_text?.trim();
          const text = refined || raw || "";

          return text
            ? `[Transcript ${index + 1} ${refined ? "refined" : "raw"}]\n${clip(
                text,
                2500
              )}`
            : "";
        })
        .filter(Boolean)
        .join("\n\n");

      const noteText = meetingNotes
        .map((note) => `[${fmtElapsed(note.elapsed_seconds)}] ${note.content}`)
        .join("\n");

      const chunkText = meetingChunks
        .slice(0, 30)
        .map(
          (chunk, index) =>
            `[Chunk ${index + 1} · ${chunk.source_type}/${chunk.memory_kind} · ${
              chunk.generated_by ?? "unknown"
            }]\n${clip(chunk.content, 900)}`
        )
        .join("\n\n");

      return [
        `# Meeting: ${meeting.date} · ${meeting.title}`,
        `Project: ${meeting.project_tag ?? "미분류"}`,
        `Participants: ${(meeting.participants ?? []).join(", ") || "Unknown"}`,
        `Agenda: ${meeting.agenda ?? "None"}`,
        "",
        "## Summary",
        clip(meeting.summary_text, 2500) || "No summary.",
        "",
        "## Notes",
        noteText || "No notes.",
        "",
        "## RAG chunks",
        chunkText || "No stored chunks.",
        "",
        "## Transcript preview",
        transcriptText || "No transcript.",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildAssetPrompt(assets: SlideAsset[]) {
  if (assets.length === 0) return "No selected assets.";

  return assets
    .map((asset) => {
      const base = [
        `Asset ID: ${asset.assetId}`,
        `Kind: ${asset.kind}`,
        `Title: ${asset.title}`,
        `Meeting ID: ${asset.meetingId}`,
        `Preview: ${clip(asset.preview, 1000)}`,
      ];

      if (asset.url) {
        base.push(`URL: ${asset.url}`);
      }

      if (asset.latex) {
        base.push(`LaTeX: ${clip(asset.latex, 1200)}`);
      }

      return base.join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt() {
  return [
    "You generate a Notion slide-like page for a research meeting.",
    "Return JSON only.",
    "The page should be concise, presentation-oriented, and structured.",
    "Use selected meeting context as factual grounding.",
    "Use good slide examples only as style and organization reference.",
    "Never invent asset IDs.",
    "Only use image or equation assets from the provided asset list.",
    "Prefer generated figure assets over original image assets when both are relevant.",
    "Use equations only when they materially clarify the slide.",
    "Do not create raw Markdown.",
    "",
    "Return schema:",
    "{",
    '  "title": "string",',
    '  "blocks": [',
    "    {\"type\":\"heading_1\",\"text\":\"...\"},",
    "    {\"type\":\"heading_2\",\"text\":\"...\"},",
    "    {\"type\":\"paragraph\",\"text\":\"...\"},",
    "    {\"type\":\"bullets\",\"items\":[\"...\",\"...\"]},",
    "    {\"type\":\"image\",\"assetId\":\"figure:...\",\"caption\":\"...\"},",
    "    {\"type\":\"equation\",\"assetId\":\"equation:...\"},",
    "    {\"type\":\"equation\",\"latex\":\"...\"},",
    "    {\"type\":\"toggle\",\"title\":\"Details\",\"children\":[...]},",
    "    {\"type\":\"divider\"}",
    "  ]",
    "}",
    "",
    "For LaTeX:",
    "Return raw KaTeX-compatible expression only.",
    "Do not include $$, \\[\\], or \\(\\).",
    "For multi-line equations, use one complete \\begin{aligned} ... \\end{aligned} block.",
  ].join("\n");
}

function planBlockToNotion(
  block: SlidePlanBlock,
  assetMap: Map<string, SlideAsset>,
  depth = 0
): NotionBlock[] {
  const type = block.type;

  if (type === "heading_1") return [heading1Block(block.text ?? "")];
  if (type === "heading_2") return [heading2Block(block.text ?? "")];
  if (type === "heading_3") return [heading3Block(block.text ?? "")];
  if (type === "paragraph") return [paragraphBlock(block.text ?? "")];
  if (type === "divider") return [dividerBlock()];

  if (type === "bullets") {
    return (block.items ?? []).map((item) => bulletBlock(item));
  }

  if (type === "image") {
    const asset = block.assetId ? assetMap.get(block.assetId) : null;

    if (!asset || !asset.url) {
      return [
        paragraphBlock(
          `[Missing or invalid image asset: ${block.assetId ?? "none"}]`
        ),
      ];
    }

    return [
      imageBlock({
        url: asset.url,
        caption: block.caption || asset.title,
      }),
    ];
  }

  if (type === "equation") {
    const asset = block.assetId ? assetMap.get(block.assetId) : null;
    const latex = normalizeLatexText(block.latex || asset?.latex || "");

    if (!latex) {
      return [
        paragraphBlock(
          `[Missing or invalid equation asset: ${block.assetId ?? "none"}]`
        ),
      ];
    }

    return [equationBlock(latex)];
  }

  if (type === "toggle") {
    const children = (block.children ?? []).flatMap((child) =>
      planBlockToNotion(child, assetMap, depth + 1)
    );

    return [
      toggleBlock(
        block.title || block.text || "Details",
        children.length > 0 ? children : [paragraphBlock("No content.")]
      ),
    ];
  }

  return [paragraphBlock(block.text ?? "")];
}

function planToNotionBlocks(plan: SlidePlan, assetMap: Map<string, SlideAsset>) {
  const rawBlocks = Array.isArray(plan.blocks) ? plan.blocks : [];

  const blocks = rawBlocks.flatMap((block) => planBlockToNotion(block, assetMap));

  if (blocks.length === 0) {
    return [paragraphBlock("No generated content.")];
  }

  return blocks;
}

export async function POST(req: Request) {
  let body: RequestBody = {};

  try {
    body = await req.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const title = cleanTitle(body.title ?? "");
  const instruction = body.instruction?.trim() ?? "";
  const targetPageId = body.targetPageId?.trim() ?? "";
  const meetingIds = normalizeStringArray(body.meetingIds);
  const assetIds = normalizeStringArray(body.assetIds);
  const exampleSlidePageIds = normalizeStringArray(body.exampleSlidePageIds);
  const exampleSlidePathMap = normalizePathMap(body.exampleSlidePathMap);
  const freeformMaterial = body.freeformMaterial?.trim() ?? "";

  if (!title) return jsonError("title is required");
  if (!instruction) return jsonError("instruction is required");
  if (!targetPageId) return jsonError("targetPageId is required");

  if (
    meetingIds.length === 0 &&
    assetIds.length === 0 &&
    freeformMaterial.length === 0
  ) {
    return jsonError("at least one meeting, asset, or freeform material is required");
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError("OPENAI_API_KEY is missing", 500);
  }

  try {
    await assertChildPageTitleAvailable({
      parentPageId: targetPageId,
      title,
      parentTitleForMessage: "selected Slides parent",
    });

    const [meetingBundle, selectedAssets, exampleContexts] = await Promise.all([
      loadMeetingBundle(meetingIds),
      loadSelectedAssets(assetIds),
      exampleSlidePageIds.length > 0
        ? loadSelectedNotionPageContexts(exampleSlidePageIds, {
            pageIdToPath: exampleSlidePathMap,
            maxCharsPerPage: 8000,
            maxDepth: 5,
          })
        : [],
    ]);

    const assetMap = new Map(
      selectedAssets.map((asset) => [asset.assetId, asset])
    );

    const userPrompt = [
      "# User instruction",
      instruction,
      "",
      "# Requested page title",
      title,
      "",
      "# Related meeting context",
      buildMeetingContext(meetingBundle),
      "",
      "# Selected assets",
      buildAssetPrompt(selectedAssets),
      "",
      "# Good slide examples",
      exampleContexts.length > 0
        ? formatNotionContextsForPrompt(exampleContexts)
        : "No selected examples.",
      "",
      "# Optional user material",
      freeformMaterial || "None.",
    ].join("\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model =
      process.env.OPENAI_SLIDE_MODEL ??
      process.env.OPENAI_REWRITE_MODEL ??
      "gpt-5.5";

    const completion = await openai.chat.completions.create({
      model,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const plan = extractJson(content) as SlidePlan;
    const blocks = planToNotionBlocks(plan, assetMap);

    const page = await createNotionPage({
      parentPageId: targetPageId,
      title,
    });

    await appendBlocks({
      blockId: page.id,
      children: blocks,
    });

    return NextResponse.json({
      ok: true,
      pageId: page.id,
      url: page.url,
      title,
      targetPageId,
      targetPath: "selected Slides parent",
      stats: {
        meetings: meetingIds.length,
        assets: selectedAssets.length,
        examples: exampleContexts.length,
        blocks: blocks.length,
      },
    });
  } catch (err: any) {
    console.error("[slide-generation] failed", err);

    if (err?.code === "NOTION_PAGE_ALREADY_EXISTS") {
      return jsonError(
        "slide page already exists in Notion",
        409,
        err?.message ?? String(err)
      );
    }

    return jsonError(
      "failed to generate Notion slide page",
      500,
      err?.message ?? String(err)
    );
  }
}