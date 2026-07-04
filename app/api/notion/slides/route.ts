import { NextResponse } from "next/server";

import { getNotionConfig } from "@/lib/notion/config";
import { buildSlidesTree } from "@/lib/notion/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getNotionConfig();
    const tree = await buildSlidesTree(config.pages.slides);

    return NextResponse.json({
      ok: true,
      root: tree.root,
      groups: tree.groups,
      ungroupedSlides: tree.ungroupedSlides,
      flatSlides: tree.flatSlides,
    });
  } catch (error: any) {
    console.error("[notion slides] failed", error);

    return NextResponse.json(
      {
        ok: false,
        error: "failed to load Notion slides",
        detail: error?.message ?? String(error),
        status: error?.status ?? null,
        code: error?.code ?? null,
      },
      { status: 500 }
    );
  }
}