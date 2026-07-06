import { NextResponse } from "next/server";
import { listDirectChildPages } from "@/lib/notion/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function GET() {
  const slidesRootPageId = process.env.NOTION_SLIDES_PAGE_ID?.trim();

  if (!slidesRootPageId) {
    return jsonError("NOTION_SLIDES_PAGE_ID is missing", 500);
  }

  try {
    const children = await listDirectChildPages(slidesRootPageId);

    return NextResponse.json({
      ok: true,
      root: {
        pageId: slidesRootPageId,
        title: "Slides",
        path: "Slides",
      },
      targets: [
        {
          pageId: slidesRootPageId,
          title: "Slides",
          path: "Slides",
        },
        ...children.map((page) => ({
          pageId: page.id,
          title: page.title,
          path: `Slides / ${page.title}`,
        })),
      ],
    });
  } catch (err: any) {
    return jsonError(
      "failed to load slide targets",
      500,
      err?.message ?? String(err)
    );
  }
}