import type { Meeting, Photo } from "@/lib/types";
import { publicUrl, supabase } from "@/lib/supabaseClient";
import {
  SlideGenerationClient,
  type SlideAssetOption,
  type SlideMeetingOption,
} from "@/components/SlideGenerationClient";

export const dynamic = "force-dynamic";

function toStorageUrl(path?: string | null): string | null {
  const cleaned = path?.trim();

  if (!cleaned) return null;

  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return cleaned;
  }

  return publicUrl(cleaned) ?? null;
}

function fmtElapsed(seconds?: number | null) {
  if (seconds == null) return "unknown";

  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec
  ).padStart(2, "0")}`;
}

function meetingTitleById(meetings: Meeting[]) {
  const map = new Map<string, string>();

  for (const meeting of meetings) {
    map.set(
      meeting.id,
      `${meeting.date ?? "Unknown"} · ${meeting.project_tag ?? "미분류"} · ${
        meeting.title ?? "Untitled"
      }`
    );
  }

  return map;
}

function buildAssetOptions(args: {
  meetings: Meeting[];
  photos: Photo[];
}): SlideAssetOption[] {
  const meetingMap = meetingTitleById(args.meetings);
  const assets: SlideAssetOption[] = [];

  for (const photo of args.photos) {
    const meetingLabel =
      meetingMap.get(photo.meeting_id) ?? `Meeting ${photo.meeting_id}`;

    const elapsed = fmtElapsed(photo.elapsed_seconds);

    if (photo.generated_figure_path?.trim()) {
      const url = toStorageUrl(photo.generated_figure_path);

      if (url) {
        assets.push({
          assetId: `figure:${photo.id}`,
          kind: "figure",
          meetingId: photo.meeting_id,
          meetingLabel,
          title: `Generated figure · ${elapsed}`,
          url,
          preview:
            photo.figure_prompt?.trim() ||
            photo.diagram_summary?.trim() ||
            "Generated figure",
        });
      }
    }

    if (photo.storage_path?.trim()) {
      const url = toStorageUrl(photo.storage_path);

      if (url) {
        assets.push({
          assetId: `image:${photo.id}`,
          kind: "image",
          meetingId: photo.meeting_id,
          meetingLabel,
          title: `Original image · ${elapsed}`,
          url,
          preview:
            photo.diagram_summary?.trim() ||
            photo.extracted_text?.trim() ||
            "Original meeting image",
        });
      }
    }

    if (photo.extracted_latex?.trim()) {
      assets.push({
        assetId: `equation:${photo.id}`,
        kind: "equation",
        meetingId: photo.meeting_id,
        meetingLabel,
        title: `Equation · ${elapsed}`,
        latex: photo.extracted_latex,
        preview: photo.extracted_latex.slice(0, 500),
      });
    }
  }

  return assets;
}

export default async function SlideGenerationPage() {
  const [{ data: meetings }, { data: photos }] = await Promise.all([
    supabase
      .from("meetings")
      .select("*")
      .order("date", { ascending: false })
      .limit(80)
      .returns<Meeting[]>(),
    supabase
      .from("photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250)
      .returns<Photo[]>(),
  ]);

  const meetingOptions: SlideMeetingOption[] = (meetings ?? []).map(
    (meeting) => ({
      id: meeting.id,
      title: meeting.title ?? "Untitled",
      date: meeting.date ?? "",
      projectTag: meeting.project_tag ?? "미분류",
      participants: meeting.participants ?? [],
      summaryPreview: meeting.summary_text?.slice(0, 260) ?? "",
    })
  );

  const assetOptions = buildAssetOptions({
    meetings: meetings ?? [],
    photos: photos ?? [],
  });

  return (
    <SlideGenerationClient
      meetings={meetingOptions}
      assets={assetOptions}
    />
  );
}