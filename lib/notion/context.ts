import "server-only";

import { pageToMarkdownText } from "./blocks";

export type SelectedNotionContext = {
  pageId: string;
  title: string;
  path: string;
  url: string | null;
  lastEditedTime: string | null;
  text: string;
};

export async function loadSelectedNotionPageContexts(
  pageIds: string[],
  options?: {
    pageIdToPath?: Record<string, string>;
    maxCharsPerPage?: number;
    maxDepth?: number;
  }
): Promise<SelectedNotionContext[]> {
  const uniquePageIds = [...new Set(pageIds)].filter(Boolean);

  const contexts = await Promise.all(
    uniquePageIds.map(async (pageId) => {
      const context = await pageToMarkdownText(pageId, {
        maxDepth: options?.maxDepth ?? 5,
        includeTitle: true,
        path: options?.pageIdToPath?.[pageId],
      });

      const maxChars = options?.maxCharsPerPage ?? 12000;

      return {
        ...context,
        text:
          context.text.length > maxChars
            ? `${context.text.slice(0, maxChars)}\n\n[TRUNCATED]`
            : context.text,
      };
    })
  );

  return contexts;
}

export function formatNotionContextsForPrompt(
  contexts: SelectedNotionContext[]
): string {
  if (contexts.length === 0) return "";

  return [
    "[Selected Notion Slide Context]",
    "",
    ...contexts.flatMap((context, index) => [
      `## Context ${index + 1}: ${context.path}`,
      context.url ? `URL: ${context.url}` : "",
      context.lastEditedTime ? `Last edited: ${context.lastEditedTime}` : "",
      "",
      context.text,
      "",
    ]),
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .trim();
}