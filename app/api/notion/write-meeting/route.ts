import { NextResponse } from "next/server";
import { publicUrl, supabase } from "@/lib/supabaseClient";
import type { Meeting, Note, Photo, Transcript } from "@/lib/types";
import {
  appendBlocks,
  assertChildPageTitleAvailable,
  bulletBlock,
  bulletLinkBlock,
  createNotionPage,
  createUniqueChildPage,
  dividerBlock,
  equationBlock,
  findOrCreateChildPage,
  heading1Block,
  heading3Block,
  imageBlock,
  paragraphBlock,
  toggleBlock,
  type NotionBlock,
} from "@/lib/notion/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  meetingId?: string;
};

type AssetLink = {
  type: "transcription" | "image" | "equation" | "figure";
  title: string;
  url: string | null;
  pageId: string;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function cleanPart(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;

  const cleaned = value.replace(/\s+/g, " ").trim();

  return cleaned || fallback;
}

function safeTitlePart(value: string) {
  return value
    .replace(/[\\/:*?"<>|#\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function peopleTitlePart(participants?: string[] | null) {
  const people = (participants ?? [])
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (people.length === 0) return "Unknown";

  return people.join(", ");
}

function buildNotionMeetingTitle(meeting: Meeting) {
  const date = safeTitlePart(cleanPart(meeting.date, "UnknownDate"));
  const title = safeTitlePart(cleanPart(meeting.title, "Untitled"));
  const people = safeTitlePart(peopleTitlePart(meeting.participants));

  return `${date}-${title}-${people}`;
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

function storageUrl(path?: string | null) {
  const cleaned = path?.trim();

  if (!cleaned) return "";

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  return publicUrl(cleaned);
}

function splitText(text: string, maxChars = 1800): string[] {
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!cleaned) return [];

  const chunks: string[] = [];
  let rest = cleaned;

  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf("\n\n", maxChars);

    if (cut < maxChars * 0.45) {
      cut = rest.lastIndexOf("\n", maxChars);
    }

    if (cut < maxChars * 0.45) {
      cut = rest.lastIndexOf(". ", maxChars);
    }

    if (cut < maxChars * 0.45) {
      cut = maxChars;
    }

    const chunk = rest.slice(0, cut).trim();

    if (chunk) chunks.push(chunk);

    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);

  return chunks;
}

function paragraphBlocks(text: string): NotionBlock[] {
  return splitText(text).map((chunk) => paragraphBlock(chunk));
}

function stripLatexFence(text: string) {
  return text
    .replace(/```latex/gi, "")
    .replace(/```tex/gi, "")
    .replace(/```/g, "")
    .replace(/\$\$/g, "")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\(/g, "")
    .replace(/\\\)/g, "")
    .trim();
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

function latexExpressions(text?: string | null): string[] {
  const cleaned = normalizeLatexText(text);

  if (!cleaned) return [];

  const environmentRegex =
    /\\begin\{(aligned|align|gathered|gather|alignedat|matrix|pmatrix|bmatrix|cases)\}[\s\S]*?\\end\{\1\}/g;

  const environments = cleaned.match(environmentRegex);

  if (environments && environments.length > 0) {
    return environments.map((expr) => expr.trim()).filter(Boolean);
  }

  const blankSplit = cleaned
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (blankSplit.length > 1) {
    return blankSplit.slice(0, 20);
  }

  return [cleaned];
}

function equationBlocks(text?: string | null): NotionBlock[] {
  return latexExpressions(text).map((expr) => equationBlock(expr));
}

function previewText(text: string, maxChars = 3000) {
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length <= maxChars) return cleaned;

  return `${cleaned.slice(
    0,
    maxChars
  ).trimEnd()}\n\n[Preview truncated. See the linked asset page for the full content.]`;
}

function preferredTranscriptText(transcript: Transcript) {
  const refined = transcript.refined_text?.trim();

  if (refined) {
    return {
      text: refined,
      version: "refined",
    };
  }

  return {
    text: transcript.full_text?.trim() ?? "",
    version: "raw",
  };
}

function makeAssetPageTitle(args: {
  meetingTitle: string;
  label: string;
  index: number;
}) {
  return `${args.meetingTitle}-${args.label}-${String(args.index + 1).padStart(
    2,
    "0"
  )}`;
}

async function createTranscriptAssetPages(args: {
  parentPageId: string;
  meetingTitle: string;
  transcripts: Transcript[];
}) {
  const assetLinks: AssetLink[] = [];

  const usable = args.transcripts
    .map((transcript, index) => ({
      transcript,
      index,
      preferred: preferredTranscriptText(transcript),
    }))
    .filter((item) => item.preferred.text.length > 0);

  for (const item of usable) {
    const title = makeAssetPageTitle({
      meetingTitle: args.meetingTitle,
      label: "transcript",
      index: item.index,
    });

    const page = await createUniqueChildPage({
      parentPageId: args.parentPageId,
      title,
    });

    const blocks: NotionBlock[] = [
      heading1Block(title),
      toggleBlock("Metadata", [
        bulletBlock(`Source: transcript ${item.index + 1}`),
        bulletBlock(`Version: ${item.preferred.version}`),
        bulletBlock(`Created at: ${item.transcript.created_at ?? "Unknown"}`),
        item.transcript.audio_path
          ? bulletBlock(`Audio path: ${item.transcript.audio_path}`)
          : paragraphBlock("Audio path: None"),
      ]),
      toggleBlock("Full transcript", paragraphBlocks(item.preferred.text)),
    ];

    await appendBlocks({
      blockId: page.id,
      children: blocks,
    });

    assetLinks.push({
      type: "transcription",
      title: page.title,
      url: page.url,
      pageId: page.id,
    });
  }

  return assetLinks;
}

async function createVisualAssetPages(args: {
  imagesPageId: string;
  equationsPageId: string;
  figuresPageId: string;
  meetingTitle: string;
  photos: Photo[];
}) {
  const assetLinks: AssetLink[] = [];

  const usable = args.photos.filter(
    (photo) =>
      photo.storage_path ||
      photo.generated_figure_path ||
      photo.extracted_text?.trim() ||
      photo.extracted_latex?.trim() ||
      photo.diagram_summary?.trim() ||
      photo.figure_prompt?.trim()
  );

  for (const [index, photo] of usable.entries()) {
    const elapsed = fmtElapsed(photo.elapsed_seconds);
    const originalUrl = storageUrl(photo.storage_path);
    const generatedUrl = storageUrl(photo.generated_figure_path);
    const renderedEquations = equationBlocks(photo.extracted_latex);

    const imageTitle = makeAssetPageTitle({
      meetingTitle: args.meetingTitle,
      label: "image",
      index,
    });

    const imagePage = await createUniqueChildPage({
      parentPageId: args.imagesPageId,
      title: imageTitle,
    });

    const imagePageBlocks: NotionBlock[] = [
      heading1Block(imageTitle),
      toggleBlock("Metadata", [
        bulletBlock(`Elapsed: ${elapsed}`),
        bulletBlock(`Photo ID: ${photo.id}`),
        bulletBlock(`Storage path: ${photo.storage_path ?? "None"}`),
        bulletBlock(
          `Generated figure path: ${photo.generated_figure_path ?? "None"}`
        ),
        bulletBlock(`Analyzed at: ${photo.analyzed_at ?? "Unknown"}`),
      ]),
    ];

    if (generatedUrl) {
      imagePageBlocks.push(
        toggleBlock("Generated figure", [
          imageBlock({
            url: generatedUrl,
            caption: `Generated figure · ${elapsed}`,
          }),
        ])
      );
    }

    if (originalUrl) {
      imagePageBlocks.push(
        toggleBlock("Original image", [
          imageBlock({
            url: originalUrl,
            caption: `Original meeting image · ${elapsed}`,
          }),
        ])
      );
    }

    if (renderedEquations.length > 0) {
      imagePageBlocks.push(
        toggleBlock("Rendered equations", renderedEquations)
      );
    }

    if (photo.extracted_text?.trim()) {
      imagePageBlocks.push(
        toggleBlock("OCR text", paragraphBlocks(photo.extracted_text))
      );
    }

    if (photo.diagram_summary?.trim()) {
      imagePageBlocks.push(
        toggleBlock(
          "Diagram summary",
          paragraphBlocks(photo.diagram_summary)
        )
      );
    }

    if (photo.figure_prompt?.trim()) {
      imagePageBlocks.push(
        toggleBlock("Figure prompt", paragraphBlocks(photo.figure_prompt))
      );
    }

    await appendBlocks({
      blockId: imagePage.id,
      children: imagePageBlocks,
    });

    assetLinks.push({
      type: "image",
      title: imagePage.title,
      url: imagePage.url,
      pageId: imagePage.id,
    });

    if (photo.extracted_latex?.trim()) {
      const equationTitle = makeAssetPageTitle({
        meetingTitle: args.meetingTitle,
        label: "equation",
        index,
      });

      const equationPage = await createUniqueChildPage({
        parentPageId: args.equationsPageId,
        title: equationTitle,
      });

      const equationPageBlocks: NotionBlock[] = [
        heading1Block(equationTitle),
        toggleBlock("Metadata", [
          bulletBlock(`Elapsed: ${elapsed}`),
          bulletBlock(`Photo ID: ${photo.id}`),
          imagePage.url
            ? bulletLinkBlock("Source image asset page", imagePage.url)
            : bulletBlock(`Source image asset page: ${imagePage.title}`),
        ]),
        toggleBlock(
          "Rendered equations",
          renderedEquations.length > 0
            ? renderedEquations
            : [paragraphBlock("No parseable LaTeX equation was found.")]
        ),
      ];

      await appendBlocks({
        blockId: equationPage.id,
        children: equationPageBlocks,
      });

      assetLinks.push({
        type: "equation",
        title: equationPage.title,
        url: equationPage.url,
        pageId: equationPage.id,
      });
    }

    if (generatedUrl || photo.figure_prompt?.trim()) {
      const figureTitle = makeAssetPageTitle({
        meetingTitle: args.meetingTitle,
        label: "figure",
        index,
      });

      const figurePage = await createUniqueChildPage({
        parentPageId: args.figuresPageId,
        title: figureTitle,
      });

      const figurePageBlocks: NotionBlock[] = [
        heading1Block(figureTitle),
        toggleBlock("Metadata", [
          bulletBlock(`Elapsed: ${elapsed}`),
          bulletBlock(`Photo ID: ${photo.id}`),
          bulletBlock(
            `Generated figure path: ${photo.generated_figure_path ?? "None"}`
          ),
          imagePage.url
            ? bulletLinkBlock("Source image asset page", imagePage.url)
            : bulletBlock(`Source image asset page: ${imagePage.title}`),
        ]),
      ];

      if (generatedUrl) {
        figurePageBlocks.push(
          toggleBlock("Generated figure", [
            imageBlock({
              url: generatedUrl,
              caption: `Generated figure · ${elapsed}`,
            }),
          ])
        );
      }

      if (renderedEquations.length > 0) {
        figurePageBlocks.push(
          toggleBlock("Rendered equations", renderedEquations)
        );
      }

      if (photo.figure_prompt?.trim()) {
        figurePageBlocks.push(
          toggleBlock("Figure prompt", paragraphBlocks(photo.figure_prompt))
        );
      }

      await appendBlocks({
        blockId: figurePage.id,
        children: figurePageBlocks,
      });

      assetLinks.push({
        type: "figure",
        title: figurePage.title,
        url: figurePage.url,
        pageId: figurePage.id,
      });
    }
  }

  return assetLinks;
}

function transcriptResultBlocks(args: {
  transcripts: Transcript[];
  assetLinks: AssetLink[];
}) {
  const blocks: NotionBlock[] = [];

  const transcriptLinks = args.assetLinks.filter(
    (asset) => asset.type === "transcription"
  );

  if (transcriptLinks.length > 0) {
    blocks.push(heading3Block("Full transcript assets"));

    for (const asset of transcriptLinks) {
      if (asset.url) {
        blocks.push(bulletLinkBlock(asset.title, asset.url));
      } else {
        blocks.push(bulletBlock(asset.title));
      }
    }
  }

  const firstUsable = args.transcripts
    .map((transcript) => preferredTranscriptText(transcript))
    .find((item) => item.text.trim().length > 0);

  if (firstUsable) {
    blocks.push(heading3Block(`Preview (${firstUsable.version})`));
    blocks.push(...paragraphBlocks(previewText(firstUsable.text)));
  } else {
    blocks.push(paragraphBlock("No transcript text is available."));
  }

  return blocks;
}

function visualResultBlocks(args: {
  photos: Photo[];
  assetLinks: AssetLink[];
}) {
  const blocks: NotionBlock[] = [];

  const visualLinks = args.assetLinks.filter(
    (asset) =>
      asset.type === "image" ||
      asset.type === "equation" ||
      asset.type === "figure"
  );

  if (visualLinks.length > 0) {
    blocks.push(heading3Block("Asset pages"));

    for (const asset of visualLinks) {
      const label = `${asset.type}: ${asset.title}`;

      if (asset.url) {
        blocks.push(bulletLinkBlock(label, asset.url));
      } else {
        blocks.push(bulletBlock(label));
      }
    }
  }

  const usable = args.photos.filter(
    (photo) =>
      photo.generated_figure_path ||
      photo.extracted_latex?.trim() ||
      photo.extracted_text?.trim() ||
      photo.diagram_summary?.trim()
  );

  if (usable.length === 0) {
    blocks.push(paragraphBlock("No visual analysis results are available."));
    return blocks;
  }

  for (const [index, photo] of usable.entries()) {
    const childBlocks: NotionBlock[] = [];
    const generatedUrl = storageUrl(photo.generated_figure_path);
    const originalUrl = storageUrl(photo.storage_path);
    const renderedEquations = equationBlocks(photo.extracted_latex);

    if (generatedUrl) {
      childBlocks.push(heading3Block("Generated figure"));
      childBlocks.push(
        imageBlock({
          url: generatedUrl,
          caption: `Generated figure · ${fmtElapsed(photo.elapsed_seconds)}`,
        })
      );
    } else if (originalUrl) {
      childBlocks.push(heading3Block("Original image"));
      childBlocks.push(
        imageBlock({
          url: originalUrl,
          caption: `Original meeting image · ${fmtElapsed(
            photo.elapsed_seconds
          )}`,
        })
      );
    }

    if (renderedEquations.length > 0) {
      childBlocks.push(heading3Block("Rendered equations"));
      childBlocks.push(...renderedEquations);
    }

    if (photo.extracted_text?.trim()) {
      childBlocks.push(heading3Block("OCR text"));
      childBlocks.push(...paragraphBlocks(previewText(photo.extracted_text, 1800)));
    }

    if (photo.diagram_summary?.trim()) {
      childBlocks.push(heading3Block("Diagram summary"));
      childBlocks.push(
        ...paragraphBlocks(previewText(photo.diagram_summary, 1200))
      );
    }

    blocks.push(
      toggleBlock(
        `Visual result ${index + 1} [${fmtElapsed(photo.elapsed_seconds)}]`,
        childBlocks.length > 0 ? childBlocks : [paragraphBlock("No result.")]
      )
    );
  }

  return blocks;
}

function noteBlocks(notes: Note[]): NotionBlock[] {
  if (notes.length === 0) {
    return [paragraphBlock("No human notes were provided.")];
  }

  return notes.map((note) =>
    bulletBlock(`[${fmtElapsed(note.elapsed_seconds)}] ${note.content}`)
  );
}

function buildMeetingBlocks(args: {
  meeting: Meeting;
  transcripts: Transcript[];
  notes: Note[];
  photos: Photo[];
  assetLinks: AssetLink[];
}) {
  const { meeting, transcripts, notes, photos, assetLinks } = args;

  const participants = peopleTitlePart(meeting.participants);

  const blocks: NotionBlock[] = [
    heading1Block(meeting.title ?? "Untitled meeting"),

    toggleBlock("Metadata", [
      bulletBlock(`Date: ${meeting.date ?? "Unknown"}`),
      bulletBlock(`Project: ${meeting.project_tag ?? "미분류"}`),
      bulletBlock(`Participants: ${participants}`),
      bulletBlock(`Agenda: ${meeting.agenda?.trim() || "None"}`),
    ]),

    dividerBlock(),

    toggleBlock(
      "Summary",
      meeting.summary_text?.trim()
        ? paragraphBlocks(meeting.summary_text)
        : [paragraphBlock("Summary has not been generated yet.")]
    ),

    dividerBlock(),

    toggleBlock("Human notes", noteBlocks(notes)),

    dividerBlock(),

    toggleBlock(
      "Visual notes",
      visualResultBlocks({
        photos,
        assetLinks,
      })
    ),

    dividerBlock(),

    toggleBlock(
      "Transcript",
      transcriptResultBlocks({
        transcripts,
        assetLinks,
      })
    ),
  ];

  return blocks;
}

export async function POST(req: Request) {
  let body: RequestBody = {};

  try {
    body = await req.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const meetingId = body.meetingId?.trim();

  if (!meetingId) {
    return jsonError("meetingId is required");
  }

  const meetingsRootPageId = process.env.NOTION_MEETINGS_PAGE_ID?.trim();

  if (!meetingsRootPageId) {
    return jsonError("NOTION_MEETINGS_PAGE_ID is missing", 500);
  }

  const assetsRootPageId = process.env.NOTION_ASSETS_PAGE_ID?.trim();

  if (!assetsRootPageId) {
    return jsonError("NOTION_ASSETS_PAGE_ID is missing", 500);
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .single<Meeting>();

  if (meetingError || !meeting) {
    return jsonError("meeting not found", 404, meetingError?.message);
  }

  const [{ data: transcripts }, { data: notes }, { data: photos }] =
    await Promise.all([
      supabase
        .from("transcripts")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true })
        .returns<Transcript[]>(),
      supabase
        .from("notes")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("elapsed_seconds", { ascending: true })
        .returns<Note[]>(),
      supabase
        .from("photos")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("elapsed_seconds", { ascending: true })
        .returns<Photo[]>(),
    ]);

  try {
    const projectTag = cleanPart(meeting.project_tag, "");
    const shouldUseProjectPage =
      projectTag.length > 0 && projectTag !== "미분류";

    const targetParent = shouldUseProjectPage
      ? await findOrCreateChildPage({
          parentPageId: meetingsRootPageId,
          title: projectTag,
        })
      : {
          id: meetingsRootPageId,
          title: "Meetings",
          created: false,
          url: null,
        };

    const pageTitle = buildNotionMeetingTitle(meeting);

    await assertChildPageTitleAvailable({
      parentPageId: targetParent.id,
      title: pageTitle,
      parentTitleForMessage: targetParent.title,
    });

    const imagesPage = await findOrCreateChildPage({
      parentPageId: assetsRootPageId,
      title: "Images",
    });

    const equationsPage = await findOrCreateChildPage({
      parentPageId: assetsRootPageId,
      title: "Equations",
    });

    const transcriptionsPage = await findOrCreateChildPage({
      parentPageId: assetsRootPageId,
      title: "Transcriptions",
    });

    const figuresPage = await findOrCreateChildPage({
      parentPageId: assetsRootPageId,
      title: "Figures",
    });

    const transcriptAssets = await createTranscriptAssetPages({
      parentPageId: transcriptionsPage.id,
      meetingTitle: pageTitle,
      transcripts: transcripts ?? [],
    });

    const visualAssets = await createVisualAssetPages({
      imagesPageId: imagesPage.id,
      equationsPageId: equationsPage.id,
      figuresPageId: figuresPage.id,
      meetingTitle: pageTitle,
      photos: photos ?? [],
    });

    const assetLinks = [...transcriptAssets, ...visualAssets];

    const blocks = buildMeetingBlocks({
      meeting,
      transcripts: transcripts ?? [],
      notes: notes ?? [],
      photos: photos ?? [],
      assetLinks,
    });

    const page = await createNotionPage({
      parentPageId: targetParent.id,
      title: pageTitle,
    });

    await appendBlocks({
      blockId: page.id,
      children: blocks,
    });

    return NextResponse.json({
      ok: true,
      pageId: page.id,
      url: page.url,
      title: pageTitle,
      parentPageId: targetParent.id,
      parentTitle: targetParent.title,
      projectPageCreated: targetParent.created,
      stats: {
        transcripts: transcripts?.length ?? 0,
        notes: notes?.length ?? 0,
        photos: photos?.length ?? 0,
        blocks: blocks.length,
        assets: {
          total: assetLinks.length,
          transcriptions: transcriptAssets.length,
          visual: visualAssets.length,
          images: visualAssets.filter((asset) => asset.type === "image").length,
          equations: visualAssets.filter((asset) => asset.type === "equation")
            .length,
          figures: visualAssets.filter((asset) => asset.type === "figure")
            .length,
        },
      },
    });
  } catch (err: any) {
    console.error("[write-meeting-to-notion] failed", err);

    if (err?.code === "NOTION_PAGE_ALREADY_EXISTS") {
      return jsonError(
        "meeting page already exists in Notion",
        409,
        err?.message ?? String(err)
      );
    }

    return jsonError(
      "failed to write meeting to Notion",
      500,
      err?.message ?? String(err)
    );
  }
}