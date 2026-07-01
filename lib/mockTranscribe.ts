export async function mockTranscribe(audioPath: string): Promise<string> {
  if (!audioPath) return "[오디오 파일 없음]";

  console.log("[mockTranscribe] audioPath:", audioPath);

  let res: Response;

  try {
    res = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audioPath }),
    });
  } catch (err) {
    console.error("[mockTranscribe] fetch crashed:", err);
    return "[STT 요청 실패: fetch crashed]";
  }

  const raw = await res.text();
  console.log("[mockTranscribe] status:", res.status);
  console.log("[mockTranscribe] raw response:", raw);

  if (!res.ok) {
    return `[STT 실패: ${res.status}]`;
  }

  const data = JSON.parse(raw);
  return data.text ?? "[STT 결과 없음]";
}