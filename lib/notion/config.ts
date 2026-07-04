import "server-only";

export type NotionPageKey =
  | "root"
  | "meetings"
  | "papers"
  | "assets"
  | "slides"
  | "experiments";

function readEnv(name: string, required = true): string {
  const value = process.env[name]?.trim();

  if (required && !value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value ?? "";
}

export function getNotionConfig() {
  return {
    token: readEnv("NOTION_TOKEN"),
    version: process.env.NOTION_VERSION?.trim() || "2022-06-28",
    pages: {
      root: readEnv("NOTION_ROOT_PAGE_ID"),
      meetings: readEnv("NOTION_MEETINGS_PAGE_ID"),
      papers: readEnv("NOTION_PAPERS_PAGE_ID"),
      assets: readEnv("NOTION_ASSETS_PAGE_ID"),
      slides: readEnv("NOTION_SLIDES_PAGE_ID"),
      experiments: readEnv("NOTION_EXPERIMENTS_PAGE_ID"),
    },
    databases: {
      papersOverall: readEnv("NOTION_PAPERS_OVERALL_DB_ID", false) || null,
    },
  };
}

export function getNotionPageId(key: NotionPageKey): string {
  return getNotionConfig().pages[key];
}

export function getNotionHeaders(): Record<string, string> {
  const config = getNotionConfig();

  return {
    Authorization: `Bearer ${config.token}`,
    "Notion-Version": config.version,
    "Content-Type": "application/json",
  };
}