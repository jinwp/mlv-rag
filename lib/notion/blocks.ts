import "server-only";

import { notionGet } from "./client";

export type NotionRichText = Array<{
  type?: string;
  plain_text?: string;
  href?: string | null;
  text?: {
    content?: string;
    link?: { url?: string } | null;
  };
  equation?: {
    expression?: string;
  };
}>;

export type NotionBlock = {
  object: "block";
  id: string;
  type: string;
  has_children?: boolean;
  created_time?: string;
  last_edited_time?: string;
  [key: string]: any;
  _children?: NotionBlock[];
};

export type NotionPage = {
  object: "page";
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, any>;
  [key: string]: any;
};

export type NotionDatabase = {
  object: "database";
  id: string;
  title?: NotionRichText;
  url?: string;
  [key: string]: any;
};

export type NotionPageMeta = {
  pageId: string;
  title: string;
  url: string | null;
  createdTime: string | null;
  lastEditedTime: string | null;
};

export type NotionSlideItem = NotionPageMeta & {
  groupTitle: string | null;
  groupPageId: string | null;
  path: string;
};

export type NotionSlideGroup = NotionPageMeta & {
  slides: NotionSlideItem[];
};

export type NotionSlidesTree = {
  root: NotionPageMeta;
  groups: NotionSlideGroup[];
  ungroupedSlides: NotionSlideItem[];
  flatSlides: NotionSlideItem[];
};

type BlockListResponse = {
  object: "list";
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
};

export async function retrievePage(pageId: string): Promise<NotionPage> {
  return notionGet<NotionPage>(`/pages/${encodeURIComponent(pageId)}`);
}

export async function retrieveDatabase(
  databaseId: string
): Promise<NotionDatabase> {
  return notionGet<NotionDatabase>(
    `/databases/${encodeURIComponent(databaseId)}`
  );
}

export async function listAllBlockChildren(
  blockId: string,
  pageSize = 100
): Promise<NotionBlock[]> {
  const results: NotionBlock[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams();
    params.set("page_size", String(pageSize));
    if (cursor) params.set("start_cursor", cursor);

    const response = await notionGet<BlockListResponse>(
      `/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`
    );

    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  return results;
}

export async function listDirectChildPages(
  blockId: string
): Promise<NotionBlock[]> {
  const children = await listAllBlockChildren(blockId);

  return children.filter(
    (block) => block.type === "child_page" && block.child_page?.title
  );
}

export function richTextToPlain(richText: NotionRichText | undefined): string {
  if (!Array.isArray(richText)) return "";

  return richText
    .map((part) => {
      if (part.type === "equation") {
        return part.equation?.expression ?? "";
      }

      return part.plain_text ?? part.text?.content ?? "";
    })
    .join("");
}

export function getPageTitle(page: NotionPage): string {
  const properties = page.properties ?? {};

  for (const property of Object.values(properties)) {
    if (property?.type === "title") {
      const title = richTextToPlain(property.title);
      if (title.trim()) return title.trim();
    }
  }

  return "Untitled";
}

export function getDatabaseTitle(database: NotionDatabase): string {
  const title = richTextToPlain(database.title);
  return title.trim() || "Untitled database";
}

export async function getPageMeta(
  pageId: string,
  fallbackTitle?: string
): Promise<NotionPageMeta> {
  const page = await retrievePage(pageId);
  const title = getPageTitle(page);

  return {
    pageId: page.id,
    title: title || fallbackTitle || "Untitled",
    url: page.url ?? null,
    createdTime: page.created_time ?? null,
    lastEditedTime: page.last_edited_time ?? null,
  };
}

async function getChildPageMeta(block: NotionBlock): Promise<NotionPageMeta> {
  const fallbackTitle = block.child_page?.title ?? "Untitled";

  try {
    return await getPageMeta(block.id, fallbackTitle);
  } catch {
    return {
      pageId: block.id,
      title: fallbackTitle,
      url: null,
      createdTime: block.created_time ?? null,
      lastEditedTime: block.last_edited_time ?? null,
    };
  }
}

export async function buildSlidesTree(
  slidesRootPageId: string
): Promise<NotionSlidesTree> {
  const root = await getPageMeta(slidesRootPageId, "Slides");
  const topLevelChildPages = await listDirectChildPages(slidesRootPageId);

  const groups: NotionSlideGroup[] = [];
  const ungroupedSlides: NotionSlideItem[] = [];

  for (const child of topLevelChildPages) {
    const childMeta = await getChildPageMeta(child);
    const nestedChildPages = await listDirectChildPages(child.id);

    if (nestedChildPages.length > 0) {
      const slides: NotionSlideItem[] = [];

      for (const slideBlock of nestedChildPages) {
        const slideMeta = await getChildPageMeta(slideBlock);

        slides.push({
          ...slideMeta,
          groupTitle: childMeta.title,
          groupPageId: childMeta.pageId,
          path: `${root.title} / ${childMeta.title} / ${slideMeta.title}`,
        });
      }

      groups.push({
        ...childMeta,
        slides,
      });
    } else {
      ungroupedSlides.push({
        ...childMeta,
        groupTitle: null,
        groupPageId: null,
        path: `${root.title} / ${childMeta.title}`,
      });
    }
  }

  const flatSlides = [
    ...groups.flatMap((group) => group.slides),
    ...ungroupedSlides,
  ];

  return {
    root,
    groups,
    ungroupedSlides,
    flatSlides,
  };
}

async function hydrateBlockChildren(
  blockId: string,
  depth: number,
  maxDepth: number
): Promise<NotionBlock[]> {
  const blocks = await listAllBlockChildren(blockId);

  if (depth >= maxDepth) {
    return blocks;
  }

  const hydrated: NotionBlock[] = [];

  for (const block of blocks) {
    const shouldHydrateChildren =
      block.has_children &&
      block.type !== "child_page" &&
      block.type !== "child_database";

    if (shouldHydrateChildren) {
      block._children = await hydrateBlockChildren(
        block.id,
        depth + 1,
        maxDepth
      );
    }

    hydrated.push(block);
  }

  return hydrated;
}

export async function getPageBlocksRecursive(
  pageId: string,
  maxDepth = 5
): Promise<NotionBlock[]> {
  return hydrateBlockChildren(pageId, 0, maxDepth);
}

function blockText(block: NotionBlock): string {
  const data = block[block.type];

  if (!data) return "";

  if (Array.isArray(data.rich_text)) {
    return richTextToPlain(data.rich_text).trim();
  }

  return "";
}

function fileUrl(data: any): string {
  if (!data) return "";

  if (data.type === "external") return data.external?.url ?? "";
  if (data.type === "file") return data.file?.url ?? "";

  return data.external?.url ?? data.file?.url ?? "";
}

function captionText(data: any): string {
  const caption = richTextToPlain(data?.caption);
  return caption ? ` — ${caption}` : "";
}

function indent(text: string, level: number): string {
  if (!text) return "";

  const prefix = "  ".repeat(level);

  return text
    .split("\n")
    .map((line) => (line.trim() ? `${prefix}${line}` : ""))
    .join("\n");
}

function blockToMarkdown(block: NotionBlock, level = 0): string {
  const type = block.type;
  const data = block[type];
  const text = blockText(block);

  let current = "";

  switch (type) {
    case "paragraph":
      current = text;
      break;

    case "heading_1":
      current = `# ${text}`;
      break;

    case "heading_2":
      current = `## ${text}`;
      break;

    case "heading_3":
      current = `### ${text}`;
      break;

    case "heading_4":
      current = `#### ${text}`;
      break;

    case "bulleted_list_item":
      current = `- ${text}`;
      break;

    case "numbered_list_item":
      current = `1. ${text}`;
      break;

    case "to_do": {
      const checked = data?.checked ? "x" : " ";
      current = `- [${checked}] ${text}`;
      break;
    }

    case "toggle":
      current = text ? `- ${text}` : "";
      break;

    case "quote":
      current = text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      break;

    case "callout":
      current = text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      break;

    case "code": {
      const language = data?.language ?? "";
      current = `~~~${language}\n${text}\n~~~`;
      break;
    }

    case "equation":
      current = data?.expression ? `$$\n${data.expression}\n$$` : "";
      break;

    case "divider":
      current = "---";
      break;

    case "child_page":
      current = `## Child page: ${data?.title ?? "Untitled"}`;
      break;

    case "child_database":
      current = `## Child database: ${data?.title ?? "Untitled database"}`;
      break;

    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = data?.url ?? "";
      current = url ? `[${type}] ${url}` : `[${type}]`;
      break;
    }

    case "image":
    case "video":
    case "pdf":
    case "file":
    case "audio": {
      const url = fileUrl(data);
      const cap = captionText(data);
      current = url ? `[${type}] ${url}${cap}` : `[${type}]${cap}`;
      break;
    }

    case "table_row": {
      const cells = Array.isArray(data?.cells)
        ? data.cells.map((cell: NotionRichText) => richTextToPlain(cell))
        : [];
      current = cells.length > 0 ? `| ${cells.join(" | ")} |` : "";
      break;
    }

    case "breadcrumb":
    case "table_of_contents":
      current = "";
      break;

    default:
      current = text || `[Unsupported block: ${type}]`;
      break;
  }

  const childText =
    block._children && block._children.length > 0
      ? blocksToMarkdown(block._children, level + 1)
      : "";

  const parts = [current, childText].filter((part) => part.trim());

  return indent(parts.join("\n"), level);
}

export function blocksToMarkdown(
  blocks: NotionBlock[],
  level = 0
): string {
  return blocks
    .map((block) => blockToMarkdown(block, level))
    .filter((text) => text.trim())
    .join("\n\n");
}

export async function pageToMarkdownText(
  pageId: string,
  options?: {
    maxDepth?: number;
    includeTitle?: boolean;
    path?: string;
  }
): Promise<{
  pageId: string;
  title: string;
  path: string;
  url: string | null;
  lastEditedTime: string | null;
  text: string;
}> {
  const meta = await getPageMeta(pageId);
  const blocks = await getPageBlocksRecursive(pageId, options?.maxDepth ?? 5);
  const body = blocksToMarkdown(blocks);

  const path = options?.path || meta.title;

  const text = options?.includeTitle === false
    ? body
    : [`# ${path}`, body].filter((part) => part.trim()).join("\n\n");

  return {
    pageId: meta.pageId,
    title: meta.title,
    path,
    url: meta.url,
    lastEditedTime: meta.lastEditedTime,
    text,
  };
}