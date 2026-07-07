"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MEDIA_BUCKET, supabase } from "@/lib/supabaseClient";
import { fmtClock, fmtLog } from "@/lib/format";
import { mockTranscribe } from "@/lib/mockTranscribe";
import { meetingModeLabel } from "@/lib/meetings/modes";

type Capture = { localId: number; url: string; elapsed: number };
type LocalNote = { localId: number; elapsed: number; content: string };

export default function RecordPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // refs mirror state so the global keydown handler reads fresh values
  const recordingRef = useRef(false);
  const elapsedRef = useRef(0);

  const [meta, setMeta] = useState<{
    title: string;
    project: string | null;
    participants: string[];
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [webcamError, setWebcamError] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // ---- load meeting meta for the header ----
  useEffect(() => {
    supabase
      .from("meetings")
      .select("title, project_tag, participants, mode")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data)
          setMeta({
            title: data.title,
            project: data.project_tag,
            participants: data.participants ?? [],
          });
      });
  }, [id]);

  // ---- webcam preview on mount ----
  useEffect(() => {
    let cancelled = false;
    async function initWebcam() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setWebcamError(false);
      } catch {
        // no camera — still try to grab audio only so recording works
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = s;
        } catch {
          /* no media at all — whiteboard captures still work */
        }
        if (!cancelled) setWebcamError(true);
      }
    }
    initWebcam();
    return () => {
      cancelled = true;
    };
  }, []);

  const drawBoard = (x: CanvasRenderingContext2D) => {
    x.fillStyle = "#f8fafc";
    x.fillRect(0, 0, 320, 180);
    x.strokeStyle = "#e3e8f0";
    x.lineWidth = 1;
    for (let gx = 0; gx <= 320; gx += 20) {
      x.beginPath();
      x.moveTo(gx, 0);
      x.lineTo(gx, 180);
      x.stroke();
    }
    for (let gy = 0; gy <= 180; gy += 20) {
      x.beginPath();
      x.moveTo(0, gy);
      x.lineTo(320, gy);
      x.stroke();
    }
    x.fillStyle = "#c2cad6";
    x.font = '600 13px "IBM Plex Mono", monospace';
    x.textAlign = "center";
    x.fillText("WHITEBOARD", 160, 92);
  };

  const capture = useCallback(() => {
    const cv = document.createElement("canvas");
    cv.width = 320;
    cv.height = 180;
    const x = cv.getContext("2d");
    if (!x) return;
    const v = videoRef.current;
    if (v && v.videoWidth > 0) {
      try {
        x.drawImage(v, 0, 0, 320, 180);
      } catch {
        drawBoard(x);
      }
    } else {
      drawBoard(x);
    }
    const currentElapsed = elapsedRef.current;
    const stamp = fmtClock(currentElapsed);
    x.fillStyle = "rgba(27,34,49,0.82)";
    x.fillRect(8, 8, 18 + stamp.length * 8, 22);
    x.fillStyle = "#fff";
    x.font = '12px "IBM Plex Mono", monospace';
    x.textAlign = "left";
    x.fillText(stamp, 15, 23);

    cv.toBlob(async (blob) => {
      if (!blob) return;
      const localId = Date.now() + Math.random();
      const url = URL.createObjectURL(blob);
      setCaptures((prev) => [{ localId, url, elapsed: currentElapsed }, ...prev]);

      const path = `${id}/photos/${Date.now()}-${Math.floor(Math.random() * 1e4)}.png`;
      const { error: upErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, blob, { contentType: "image/png" });
      if (upErr) {
        console.error("[record] photo upload failed", upErr.message);
        return;
      }
      await supabase.from("photos").insert({
        meeting_id: id,
        storage_path: path,
        elapsed_seconds: currentElapsed,
      });
    }, "image/png");
  }, [id]);

  // ---- spacebar capture (ignored while typing in inputs/textareas) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!recordingRef.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      capture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  };
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecorder = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;
    try {
      const rec = new MediaRecorder(new MediaStream(audioTracks));
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.start();
      recorderRef.current = rec;
    } catch (err) {
      console.error("[record] MediaRecorder failed", err);
    }
  };

  const stopRecorder = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })
          : null;
        resolve(blob);
      };
      rec.stop();
    });

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const toggleRec = () => {
    if (recording) {
      clearTimer();
      setRecording(false);
      // keep recorder running so audio is continuous; pausing only stops the timer
    } else {
      startTimer();
      if (!recorderRef.current || recorderRef.current.state === "inactive") startRecorder();
      setRecording(true);
    }
  };

  const addNote = () => {
    setNotes((prev) => [
      ...prev,
      { localId: Date.now() + Math.random(), elapsed: elapsedRef.current, content: "" },
    ]);
  };
  const updateNote = (localId: number, content: string) => {
    setNotes((prev) => prev.map((n) => (n.localId === localId ? { ...n, content } : n)));
  };

  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
    };
  }, []);

  const endAndSave = async () => {
    if (saving) return;
    setSaving(true);
    clearTimer();
    setRecording(false);

    // 1) finalize audio
    const audioBlob = await stopRecorder();
    let audioPath: string | null = null;
    if (audioBlob) {
      const path = `${id}/audio/${Date.now()}.webm`;
      const { error: upErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, audioBlob, { contentType: audioBlob.type || "audio/webm" });
      if (upErr) console.error("[record] audio upload failed", upErr.message);
      else audioPath = path;
    }
    stopStream();

    // 2) STT (placeholder for now — teammate swaps mockTranscribe internals later)
    const fullText = await mockTranscribe(audioPath ?? "");
    await supabase.from("transcripts").insert({
      meeting_id: id,
      full_text: fullText,
      audio_path: audioPath,
    });

    // 3) persist notes captured during the meeting
    const rows = notes
      .filter((n) => n.content.trim())
      .map((n) => ({
        meeting_id: id,
        content: n.content.trim(),
        elapsed_seconds: n.elapsed,
      }));
    if (rows.length) await supabase.from("notes").insert(rows);

    router.push(`/meetings/${id}`);
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* rec header */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "16px 26px",
          borderBottom: "1px solid #e4e8ef",
          background: "#fff",
        }}
      >
        <button
          type="button"
          onClick={toggleRec}
          style={{
            flex: "none",
            borderRadius: 9,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            border: `1px solid ${recording ? "#e5484d" : "#3550c7"}`,
            ...(recording
              ? { background: "#fdecec", color: "#c0323a" }
              : { background: "#3550c7", color: "#fff" }),
          }}
        >
          {recording ? "■ 정지" : "● 녹음 시작"}
        </button>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          {recording && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#e5484d",
                display: "inline-block",
                animation: "recpulse 1.1s ease-in-out infinite",
              }}
            />
          )}
          <span
            className="mono"
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: ".01em",
              color: "#1b2231",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtClock(elapsed)}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".08em",
              padding: "2px 7px",
              borderRadius: 5,
              ...(recording
                ? { background: "#fdecec", color: "#c0323a" }
                : { background: "#eef1f5", color: "#9aa3b2" }),
            }}
          >
            {recording ? "REC" : "일시정지"}
          </span>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right", maxWidth: "46%" }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14.5,
              color: "#1b2231",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meta?.title ?? "(제목 없음)"}
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "#8a93a3", marginTop: 2 }}>
            {(meta?.project ?? "")} · {(meta?.participants ?? []).join(", ")}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* webcam + captures */}
        <div
          style={{
            flex: "0 0 46%",
            borderRight: "1px solid #e4e8ef",
            display: "flex",
            flexDirection: "column",
            padding: 20,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "relative",
              borderRadius: 12,
              overflow: "hidden",
              background: "#0f1420",
              aspectRatio: "16/9",
              flex: "none",
              border: "1px solid #d9dfe8",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            {webcamError && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "#f8fafc",
                  backgroundImage:
                    "linear-gradient(#e6ebf3 1px,transparent 1px),linear-gradient(90deg,#e6ebf3 1px,transparent 1px)",
                  backgroundSize: "22px 22px",
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 13, color: "#9aa3b2", fontWeight: 600, letterSpacing: ".06em" }}
                >
                  WEBCAM OFFLINE
                </div>
                <div className="mono" style={{ fontSize: 11, color: "#b3bcc9" }}>
                  카메라 없이도 캡처 가능 (whiteboard)
                </div>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "rgba(15,20,32,.72)",
                backdropFilter: "blur(4px)",
                padding: "5px 10px",
                borderRadius: 7,
              }}
            >
              <kbd
                className="mono"
                style={{
                  fontSize: 11,
                  background: "#e9edf4",
                  color: "#1b2231",
                  padding: "2px 8px",
                  borderRadius: 5,
                  fontWeight: 600,
                  boxShadow: "0 1px 0 #b9c2d0",
                }}
              >
                Space
              </kbd>
              <span style={{ color: "#cdd4e0", fontSize: 12 }}>눌러서 사진 캡처</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: "18px 0 10px",
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252" }}>캡처된 사진</div>
            <div className="mono" style={{ fontSize: 11, color: "#9aa3b2" }}>
              {captures.length} shots
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              alignContent: "start",
            }}
          >
            {captures.map((c) => (
              <div
                key={c.localId}
                style={{
                  border: "1px solid #e0e5ee",
                  borderRadius: 9,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.url}
                  alt={`capture at ${fmtLog(c.elapsed)}`}
                  style={{ width: "100%", display: "block", aspectRatio: "16/9", objectFit: "cover" }}
                />
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "#7a8496",
                    padding: "5px 8px",
                    borderTop: "1px solid #eef1f5",
                  }}
                >
                  [{fmtLog(c.elapsed)}]
                </div>
              </div>
            ))}
            {captures.length === 0 && (
              <div
                style={{
                  gridColumn: "1/-1",
                  border: "1px dashed #d5dce6",
                  borderRadius: 9,
                  padding: 22,
                  textAlign: "center",
                  color: "#a6afbd",
                  fontSize: 12.5,
                }}
              >
                아직 캡처된 사진이 없습니다
              </div>
            )}
          </div>
        </div>

        {/* notes */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "20px 22px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4252" }}>실시간 메모</div>
            <button
              type="button"
              onClick={addNote}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                border: "1px solid #d8dee7",
                background: "#fff",
                color: "#3550c7",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              + 메모 추가
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {notes.map((n) => (
              <div
                key={n.localId}
                style={{
                  border: "1px solid #e4e8ef",
                  borderRadius: 10,
                  background: "#fff",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 12px",
                    borderBottom: "1px solid #f0f2f6",
                    background: "#fafbfd",
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "#3550c7" }}>
                    [{fmtLog(n.elapsed)}]
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: "#aab2c0" }}>
                    note
                  </span>
                </div>
                <textarea
                  value={n.content}
                  onChange={(e) => updateNote(n.localId, e.target.value)}
                  rows={2}
                  placeholder="논문 링크: … / TODO: … / 결정: …"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    padding: "10px 12px",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "#1b2231",
                    background: "transparent",
                  }}
                />
              </div>
            ))}
            {notes.length === 0 && (
              <div
                style={{
                  border: "1px dashed #d5dce6",
                  borderRadius: 10,
                  padding: 26,
                  textAlign: "center",
                  color: "#a6afbd",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <div
                  className="mono"
                  style={{ fontSize: 22, color: "#cdd4e0", marginBottom: 6 }}
                >
                  +
                </div>
                회의 중 떠오른 링크·TODO·결정사항을
                <br />
                메모로 남기세요. 경과 시간이 자동 첨부됩니다.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={endAndSave}
            disabled={saving}
            style={{
              marginTop: 16,
              flex: "none",
              width: "100%",
              border: "none",
              background: saving ? "#3a4252" : "#1b2231",
              color: "#fff",
              borderRadius: 10,
              padding: 14,
              fontSize: 15,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              letterSpacing: "-.01em",
            }}
          >
            {saving ? "저장 중…" : "■ 종료 및 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
