import "server-only";

import { getNotionHeaders } from "./config";

const NOTION_API_BASE = "https://api.notion.com/v1";

export class NotionApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function parseNotionResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  return res.text();
}

export async function notionFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      ...getNotionHeaders(),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = await parseNotionResponse(res);

  if (!res.ok) {
    const maybeBody = body as {
      message?: string;
      code?: string;
      status?: number;
    };

    throw new NotionApiError(
      maybeBody?.message || `Notion API request failed: ${res.status}`,
      res.status,
      maybeBody?.code,
      body
    );
  }

  return body as T;
}

export async function notionGet<T>(path: string): Promise<T> {
  return notionFetch<T>(path, { method: "GET" });
}

export async function notionPost<T>(
  path: string,
  body: unknown
): Promise<T> {
  return notionFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function notionPatch<T>(
  path: string,
  body: unknown
): Promise<T> {
  return notionFetch<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}