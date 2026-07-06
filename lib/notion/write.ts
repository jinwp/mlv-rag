type NotionRichText = {
  type: "text";
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: Record<string, boolean>;
};

export type NotionBlock = Record<string, any>;

const NOTION_API_BASE = "https://api.notion.com/v1";
function pushRichText(
  out: NotionRichText[],
  content: string,
  options?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    link?: string | null;
  }
) {
  let rest = content;

  while (rest.length > 0) {
    const chunk = rest.slice(0, 2000);
    rest = rest.slice(2000);

    if (!chunk) continue;

    out.push({
      type: "text",
      text: {
        content: chunk,
        link: options?.link ? { url: options.link } : null,
      },
      annotations: {
        bold: options?.bold ?? false,
        italic: options?.italic ?? false,
        code: options?.code ?? false,
      },
    });
  }
}

function stripFenceDelimiters(content: string) {
  return content
    .replace(/```(?:text|txt|markdown|md)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function shouldRenderInlineCode(content: string) {
  const text = content.trim();

  if (!text) return false;

  // Short identifiers/functions are fine as inline code.
  if (
    text.length <= 80 &&
    /^[A-Za-z0-9_.$:/()[\]{}<>,+\-*=|]+$/.test(text)
  ) {
    return true;
  }

  // Natural-language rules, prompts, or long traces should not become red code pills.
  return false;
}

export function richTextFromInlineMarkdown(content: string): NotionRichText[] {
  const out: NotionRichText[] = [];
  const text = stripFenceDelimiters(content ?? "");
  const tokenRegex = /(\*\*[^*]+?\*\*|`[^`]+?`)/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;

    if (start > cursor) {
      pushRichText(out, text.slice(cursor, start));
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      pushRichText(out, token.slice(2, -2), { bold: true });
    } else if (token.startsWith("`") && token.endsWith("`")) {
      const inner = token.slice(1, -1).trim();

      if (shouldRenderInlineCode(inner)) {
        pushRichText(out, inner, { code: true });
      } else {
        pushRichText(out, inner);
      }
    } else {
      pushRichText(out, token);
    }

    cursor = start + token.length;
  }

  if (cursor < text.length) {
    pushRichText(out, text.slice(cursor));
  }

  return out.length > 0 ? out : richText(text);
}

export function markdownParagraphBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richTextFromInlineMarkdown(text),
    },
  };
}

export function markdownBulletBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: richTextFromInlineMarkdown(text),
    },
  };
}

export function markdownNumberedBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: richTextFromInlineMarkdown(text),
    },
  };
}

function markdownHeadingBlock(text: string, level: 1 | 2 | 3): NotionBlock {
  if (level === 1) {
    return {
      object: "block",
      type: "heading_1",
      heading_1: {
        rich_text: richTextFromInlineMarkdown(text),
      },
    };
  }

  if (level === 2) {
    return {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: richTextFromInlineMarkdown(text),
      },
    };
  }

  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: richTextFromInlineMarkdown(text),
    },
  };
}

function normalizeFencedLine(line: string) {
  return line
    .replace(/^text\s+/i, "")
    .replace(/^txt\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarkdownTableLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed.includes("|")) return false;

  return (
    trimmed.startsWith("|") ||
    trimmed.endsWith("|") ||
    trimmed.split("|").length >= 3
  );
}

function isMarkdownTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
    line.trim()
  );
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function tableLinesToBlocks(lines: string[]): NotionBlock[] {
  const rows = lines
    .filter((line) => !isMarkdownTableSeparator(line))
    .map(parseMarkdownTableRow)
    .filter((row) => row.length > 0);

  if (rows.length === 0) return [];

  const [header, ...bodyRows] = rows;

  if (bodyRows.length === 0) {
    return [markdownParagraphBlock(header.join(" · "))];
  }

  return bodyRows.map((row) => {
    const parts = row.map((cell, index) => {
      const key = header[index];

      return key ? `${key}: ${cell}` : cell;
    });

    return markdownBulletBlock(parts.join(" · "));
  });
}

export function markdownToNotionBlocks(
  markdown: string,
  options?: {
    compactHeadings?: boolean;
  }
): NotionBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: NotionBlock[] = [];
  const paragraphLines: string[] = [];
  const fencedLines: string[] = [];
  const tableLines: string[] = [];

  let inFence = false;

  function flushParagraph() {
    const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    paragraphLines.length = 0;

    if (!text) return;

    blocks.push(markdownParagraphBlock(text));
  }

  function flushFence() {
    const cleanLines = fencedLines
      .map(normalizeFencedLine)
      .filter(Boolean);

    fencedLines.length = 0;

    if (cleanLines.length === 0) return;

    for (const line of cleanLines) {
      blocks.push(markdownBulletBlock(line));
    }
  }

  function flushTable() {
    if (tableLines.length === 0) return;

    const tableBlocks = tableLinesToBlocks(tableLines);
    tableLines.length = 0;

    if (tableBlocks.length > 0) {
      blocks.push(...tableBlocks);
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      flushTable();

      if (inFence) {
        inFence = false;
        flushFence();
      } else {
        inFence = true;
      }

      continue;
    }

    if (inFence) {
      fencedLines.push(rawLine);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushTable();
      continue;
    }

    if (isMarkdownTableLine(line)) {
      flushParagraph();
      tableLines.push(line);
      continue;
    }

    flushTable();

    if (/^---+$/.test(line)) {
      flushParagraph();
      blocks.push(dividerBlock());
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      flushParagraph();

      const rawLevel = headingMatch[1].length as 1 | 2 | 3;
      const level = options?.compactHeadings ? 3 : rawLevel;
      const text = headingMatch[2].trim();

      blocks.push(markdownHeadingBlock(text, level));
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);

    if (bulletMatch) {
      flushParagraph();
      blocks.push(markdownBulletBlock(bulletMatch[1].trim()));
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);

    if (numberedMatch) {
      flushParagraph();
      blocks.push(markdownNumberedBlock(numberedMatch[1].trim()));
      continue;
    }

    paragraphLines.push(line);
  }

  if (inFence) {
    flushFence();
  }

  flushParagraph();
  flushTable();

  return blocks.length > 0 ? blocks : [paragraphBlock("No content.")];
}

function getNotionToken() {
  const token = process.env.NOTION_TOKEN;

  if (!token) {
    throw new Error("NOTION_TOKEN is missing");
  }

  return token;
}

function getNotionVersion() {
  return process.env.NOTION_VERSION ?? "2022-06-28";
}

async function notionRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getNotionToken()}`,
      "Notion-Version": getNotionVersion(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.message ??
        `Notion API request failed: ${res.status} ${res.statusText}`
    );
  }

  return data as T;
}

export function richText(
  content: string,
  options?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    link?: string | null;
  }
): NotionRichText[] {
  const text = content.slice(0, 2000);

  if (!text) return [];

  return [
    {
      type: "text",
      text: {
        content: text,
        link: options?.link ? { url: options.link } : null,
      },
      annotations: {
        bold: options?.bold ?? false,
        italic: options?.italic ?? false,
        code: options?.code ?? false,
      },
    },
  ];
}

export function heading1Block(text: string): NotionBlock {
  return {
    object: "block",
    type: "heading_1",
    heading_1: {
      rich_text: richText(text),
    },
  };
}

export function heading2Block(text: string): NotionBlock {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: richText(text),
    },
  };
}

export function heading3Block(text: string): NotionBlock {
  return {
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: richText(text),
    },
  };
}

export function paragraphBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(text),
    },
  };
}

export function linkParagraphBlock(label: string, url: string): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: label.slice(0, 2000),
            link: {
              url,
            },
          },
          annotations: {
            bold: true,
          },
        },
      ],
    },
  };
}

export function bulletBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: richText(text),
    },
  };
}

export function bulletLinkBlock(label: string, url: string): NotionBlock {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        {
          type: "text",
          text: {
            content: label.slice(0, 2000),
            link: {
              url,
            },
          },
          annotations: {
            bold: true,
          },
        },
      ],
    },
  };
}

export function numberedBlock(text: string): NotionBlock {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: richText(text),
    },
  };
}

export function codeBlock(text: string, language = "plain text"): NotionBlock {
  return {
    object: "block",
    type: "code",
    code: {
      language,
      rich_text: richText(text),
    },
  };
}

export function equationBlock(expression: string): NotionBlock {
  return {
    object: "block",
    type: "equation",
    equation: {
      expression: expression.trim(),
    },
  };
}

export function dividerBlock(): NotionBlock {
  return {
    object: "block",
    type: "divider",
    divider: {},
  };
}

export function imageBlock(args: {
  url: string;
  caption?: string;
}): NotionBlock {
  return {
    object: "block",
    type: "image",
    image: {
      type: "external",
      external: {
        url: args.url,
      },
      caption: args.caption ? richText(args.caption) : [],
    },
  };
}

export function toggleBlock(
  title: string,
  children: NotionBlock[] = []
): NotionBlock {
  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: richText(title),
      color: "default",
      children,
    },
  };
}

export function toggleBlocks(
  title: string,
  children: NotionBlock[] = [],
  maxChildren = 90
): NotionBlock[] {
  const cleanChildren = children.filter(Boolean);

  if (cleanChildren.length === 0) {
    return [toggleBlock(title, [paragraphBlock("No content.")])];
  }

  if (cleanChildren.length <= maxChildren) {
    return [toggleBlock(title, cleanChildren)];
  }

  const blocks: NotionBlock[] = [];

  for (let i = 0; i < cleanChildren.length; i += maxChildren) {
    const part = Math.floor(i / maxChildren) + 1;
    const total = Math.ceil(cleanChildren.length / maxChildren);
    const chunk = cleanChildren.slice(i, i + maxChildren);

    blocks.push(
      toggleBlock(total === 1 ? title : `${title} (${part}/${total})`, chunk)
    );
  }

  return blocks;
}

export async function createNotionPage(args: {
  parentPageId: string;
  title: string;
  children?: NotionBlock[];
}) {
  return notionRequest<{
    id: string;
    url: string;
  }>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: {
        page_id: args.parentPageId,
      },
      properties: {
        title: {
          title: richText(args.title),
        },
      },
      children: args.children ?? [],
    }),
  });
}

export async function appendBlocks(args: {
  blockId: string;
  children: NotionBlock[];
}) {
  const children = args.children.filter(Boolean);

  for (let i = 0; i < children.length; i += 90) {
    const batch = children.slice(i, i + 90);

    await notionRequest(`/blocks/${args.blockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({
        children: batch,
      }),
    });
  }
}

export async function listDirectChildPages(parentBlockId: string) {
  const pages: Array<{
    id: string;
    title: string;
  }> = [];

  let cursor: string | undefined;

  do {
    const data = await notionRequest<{
      results: any[];
      has_more: boolean;
      next_cursor: string | null;
    }>(
      `/blocks/${parentBlockId}/children?page_size=100${
        cursor ? `&start_cursor=${cursor}` : ""
      }`,
      {
        method: "GET",
      }
    );

    for (const block of data.results ?? []) {
      if (block.type === "child_page") {
        pages.push({
          id: block.id,
          title: block.child_page?.title ?? "Untitled",
        });
      }
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export async function findChildPageByTitle(args: {
  parentPageId: string;
  title: string;
}) {
  const children = await listDirectChildPages(args.parentPageId);

  return (
    children.find((page) => page.title.trim() === args.title.trim()) ?? null
  );
}

export async function assertChildPageTitleAvailable(args: {
  parentPageId: string;
  title: string;
  parentTitleForMessage?: string;
}) {
  const existing = await findChildPageByTitle({
    parentPageId: args.parentPageId,
    title: args.title,
  });

  if (existing) {
    const parent = args.parentTitleForMessage ?? args.parentPageId;

    const error = new Error(
      `A Notion page with the same title already exists under ${parent}: ${args.title}`
    );

    (error as any).code = "NOTION_PAGE_ALREADY_EXISTS";
    (error as any).existingPageId = existing.id;

    throw error;
  }
}

export async function findOrCreateChildPage(args: {
  parentPageId: string;
  title: string;
}) {
  const existing = await findChildPageByTitle({
    parentPageId: args.parentPageId,
    title: args.title,
  });

  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      created: false,
      url: null as string | null,
    };
  }

  const created = await createNotionPage({
    parentPageId: args.parentPageId,
    title: args.title,
  });

  return {
    id: created.id,
    title: args.title,
    created: true,
    url: created.url ?? null,
  };
}

export async function createUniqueChildPage(args: {
  parentPageId: string;
  title: string;
}) {
  const children = await listDirectChildPages(args.parentPageId);
  const usedTitles = new Set(children.map((page) => page.title.trim()));

  let title = args.title.trim();
  let suffix = 2;

  while (usedTitles.has(title)) {
    title = `${args.title.trim()}-${suffix}`;
    suffix += 1;
  }

  const created = await createNotionPage({
    parentPageId: args.parentPageId,
    title,
  });

  return {
    id: created.id,
    title,
    url: created.url ?? null,
  };
}