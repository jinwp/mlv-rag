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