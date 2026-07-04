import { NextRequest, NextResponse } from "next/server";

import { pageToMarkdownText } from "@/lib/notion/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMaxChars(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1000, Math.min(value, 50000));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1000, Math.min(parsed, 50000));
    }
  }

  return 12000;
}

async function handleRequest(req: NextRequest) {
  const url = new URL(req.url);

  let body: any = {};

  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const pageId =
    body.pageId ||
    url.searchParams.get("pageId") ||
    url.searchParams.get("id");

  if (!pageId || typeof pageId !== "string") {
    return NextResponse.json(
      { ok: false, error: "pageId is required" },
      { status: 400 }
    );
  }

  const path =
    typeof body.path === "string"
      ? body.path
      : url.searchParams.get("path") ?? undefined;

  const maxChars = normalizeMaxChars(
    body.maxChars ?? url.searchParams.get("maxChars")
  );

  try {
    const context = await pageToMarkdownText(pageId, {
      maxDepth: 5,
      includeTitle: true,
      path,
    });

    const text =
      context.text.length > maxChars
        ? `${context.text.slice(0, maxChars)}\n\n[TRUNCATED]`
        : context.text;

    return NextResponse.json({
      ok: true,
      ...context,
      text,
      truncated: context.text.length > maxChars,
      originalCharLength: context.text.length,
      returnedCharLength: text.length,
    });
  } catch (error: any) {
    console.error("[notion page-to-text] failed", error);

    return NextResponse.json(
      {
        ok: false,
        error: "failed to convert Notion page to text",
        detail: error?.message ?? String(error),
        status: error?.status ?? null,
        code: error?.code ?? null,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}