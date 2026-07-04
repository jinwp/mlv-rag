import { NextResponse } from "next/server";

import { getNotionConfig } from "@/lib/notion/config";
import {
  getDatabaseTitle,
  getPageMeta,
  retrieveDatabase,
} from "@/lib/notion/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkPage(pageId: string, label: string) {
  try {
    const meta = await getPageMeta(pageId);

    return {
      ok: true,
      label,
      pageId,
      title: meta.title,
      url: meta.url,
      lastEditedTime: meta.lastEditedTime,
    };
  } catch (error: any) {
    return {
      ok: false,
      label,
      pageId,
      error: error?.message ?? String(error),
      status: error?.status ?? null,
      code: error?.code ?? null,
    };
  }
}

async function checkDatabase(databaseId: string, label: string) {
  try {
    const database = await retrieveDatabase(databaseId);

    return {
      ok: true,
      label,
      databaseId,
      title: getDatabaseTitle(database),
      url: database.url ?? null,
    };
  } catch (error: any) {
    return {
      ok: false,
      label,
      databaseId,
      error: error?.message ?? String(error),
      status: error?.status ?? null,
      code: error?.code ?? null,
    };
  }
}

export async function GET() {
  try {
    const config = getNotionConfig();

    const pageChecks = await Promise.all([
      checkPage(config.pages.root, "root"),
      checkPage(config.pages.meetings, "meetings"),
      checkPage(config.pages.papers, "papers"),
      checkPage(config.pages.assets, "assets"),
      checkPage(config.pages.slides, "slides"),
      checkPage(config.pages.experiments, "experiments"),
    ]);

    const databaseChecks = config.databases.papersOverall
      ? [
          await checkDatabase(
            config.databases.papersOverall,
            "papersOverall"
          ),
        ]
      : [];

    const ok =
      pageChecks.every((item) => item.ok) &&
      databaseChecks.every((item) => item.ok);

    return NextResponse.json({
      ok,
      notionVersion: config.version,
      pages: Object.fromEntries(
        pageChecks.map((item) => [item.label, item])
      ),
      databases: Object.fromEntries(
        databaseChecks.map((item) => [item.label, item])
      ),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}