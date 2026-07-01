import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/supabaseClient";

export const runtime = "nodejs";

type ClovaSpeaker =
  | string
  | {
      label?: string;
      name?: string;
      edited?: boolean;
    };

type ClovaSegment = {
  start?: number;
  end?: number;
  text?: string;
  speaker?: ClovaSpeaker;
};

type ClovaResponse = {
  text?: string;
  segments?: ClovaSegment[];
  speakers?: unknown[];
};

function normalizeInvokeUrl(rawUrl: string) {
  const trimmed = rawUrl.trim().replace(/\/$/, "");

  if (trimmed.endsWith("/recognizer/upload")) {
    return trimmed;
  }

  return `${trimmed}/recognizer/upload`;
}

function getSpeakerLabel(speaker?: ClovaSpeaker) {
  if (!speaker) return "Speaker";

  if (typeof speaker === "string") {
    return speaker.startsWith("Speaker") ? speaker : `Speaker ${speaker}`;
  }

  const name = speaker.name?.trim();
  if (name) return name;

  const label = speaker.label?.trim();
  if (label) return `Speaker ${label}`;

  return "Speaker";
}

function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatClovaSegments(segments: ClovaSegment[]) {
  const maxTime = Math.max(
    0,
    ...segments.flatMap((seg) => [seg.start ?? 0, seg.end ?? 0])
  );

  // CLOVA Speech segment timestamps are commonly returned in milliseconds.
  // This keeps the formatter robust if the API ever returns seconds.
  const timestampsAreMs = maxTime > 1000;

  return segments
    .map((seg) => {
      const startRaw = seg.start ?? 0;
      const endRaw = seg.end ?? startRaw;

      const startSec = timestampsAreMs ? startRaw / 1000 : startRaw;
      const endSec = timestampsAreMs ? endRaw / 1000 : endRaw;

      const start = fmtTime(startSec);
      const end = fmtTime(endSec);
      const speaker = getSpeakerLabel(seg.speaker);
      const text = seg.text?.trim() ?? "";

      return `[${start} - ${end}] ${speaker}: ${text}`;
    })
    .filter((line) => !line.endsWith(":"))
    .join("\n");
}

export async function POST(req: Request) {
  try {
    const { audioPath } = await req.json();

    if (!audioPath) {
      return NextResponse.json(
        { error: "audioPath is required" },
        { status: 400 }
      );
    }

    const clovaSecret = process.env.NAVER_CLOVA_SPEECH_SECRET;
    const clovaInvokeUrl = process.env.NAVER_CLOVA_SPEECH_INVOKE_URL;

    if (!clovaSecret || !clovaInvokeUrl) {
      return NextResponse.json(
        {
          error:
            "NAVER_CLOVA_SPEECH_SECRET or NAVER_CLOVA_SPEECH_INVOKE_URL is missing",
        },
        { status: 500 }
      );
    }

    const audioUrl = publicUrl(audioPath);

    if (!audioUrl) {
      return NextResponse.json(
        { error: "failed to resolve audio url" },
        { status: 400 }
      );
    }

    console.log("[transcribe] provider: clova");
    console.log("[transcribe] audioPath:", audioPath);
    console.log("[transcribe] audioUrl:", audioUrl);

    const audioRes = await fetch(audioUrl);

    if (!audioRes.ok) {
      return NextResponse.json(
        { error: `failed to fetch audio from storage: ${audioRes.status}` },
        { status: 500 }
      );
    }

    const audioArrayBuffer = await audioRes.arrayBuffer();
    const audioContentType =
      audioRes.headers.get("content-type") ?? "audio/webm";

    const audioBlob = new Blob([audioArrayBuffer], {
      type: audioContentType,
    });

    const audioFile = new File([audioBlob], "meeting.webm", {
      type: audioContentType,
    });

    const params = {
      language: "ko-KR",
      completion: "sync",
      fullText: true,
      wordAlignment: true,
      diarization: {
        enable: true,
        speakerCountMin: 1,
        speakerCountMax: 8,
      },
    };

    const formData = new FormData();
    formData.append("media", audioFile);
    formData.append("params", JSON.stringify(params));

    const uploadUrl = normalizeInvokeUrl(clovaInvokeUrl);

    const clovaRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-CLOVASPEECH-API-KEY": clovaSecret,
        Accept: "application/json",
      },
      body: formData,
    });

    const raw = await clovaRes.text();

    if (!clovaRes.ok) {
      console.error("[transcribe] CLOVA failed:", clovaRes.status, raw);

      return NextResponse.json(
        {
          error: `CLOVA Speech failed: ${clovaRes.status}`,
          detail: raw,
        },
        { status: 500 }
      );
    }

    let data: ClovaResponse;

    try {
      data = JSON.parse(raw) as ClovaResponse;
    } catch {
      console.error("[transcribe] CLOVA returned non-JSON:", raw);

      return NextResponse.json(
        {
          error: "CLOVA Speech returned non-JSON response",
          detail: raw,
        },
        { status: 500 }
      );
    }

    const segments = data.segments ?? [];
    const text =
      segments.length > 0 ? formatClovaSegments(segments) : data.text ?? "";

    return NextResponse.json({
      provider: "naver:clova-speech",
      text,
      segments,
      raw: data,
    });
  } catch (err: any) {
    console.error("[transcribe] failed", err);

    return NextResponse.json(
      {
        error: "transcription failed",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}