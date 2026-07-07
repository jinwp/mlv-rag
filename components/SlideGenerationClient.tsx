"use client";

import { useEffect, useMemo, useState } from "react";
import NotionSlideContextPicker, {
  NotionSlideListItem,
} from "@/components/NotionSlideContextPicker";
import {
  BUILTIN_INSTRUCTION_PRESETS,
  type InstructionPreset,
} from "@/lib/slide-generation/presets";

export type SlideMeetingOption = {
  id: string;
  title: string;
  date: string;
  projectTag: string;
  participants: string[];
  summaryPreview: string;
};

export type SlideAssetOption = {
  assetId: string;
  kind: "image" | "figure" | "equation";
  meetingId: string;
  meetingLabel: string;
  title: string;
  url?: string;
  latex?: string;
  preview: string;
};

type SlideTarget = {
  pageId: string;
  title: string;
  path: string;
};

type GenerateResponse = {
  ok?: boolean;
  pageId?: string;
  url?: string;
  title?: string;
  targetPath?: string;
  stats?: {
    meetings?: number;
    assets?: number;
    examples?: number;
    blocks?: number;
  };
  error?: string;
  details?: unknown;
};

type Props = {
  meetings: SlideMeetingOption[];
  assets: SlideAssetOption[];
};

const INSTRUCTION_PRESET_STORAGE_KEY =
  "mlv-rag.slide-generation.instruction-presets.v1";

const pageWrap: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "auto",
  padding: "34px 30px 80px",
};

const shell: React.CSSProperties = {
  maxWidth: 1220,
  margin: "0 auto",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 390px",
  gap: 20,
  alignItems: "start",
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e8ef",
  borderRadius: 13,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
};

const cardHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "13px 18px",
  borderBottom: "1px solid #eceff4",
  background: "#fafbfd",
};

const body: React.CSSProperties = {
  padding: 18,
  display: "grid",
  gap: 14,
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 800,
  color: "#334155",
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d9dee8",
  borderRadius: 9,
  padding: "10px 11px",
  fontSize: 13,
  outline: "none",
  background: "#fff",
};

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 150,
  resize: "vertical",
  lineHeight: 1.5,
};

const button: React.CSSProperties = {
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  borderRadius: 9,
  padding: "10px 13px",
  cursor: "pointer",
  fontWeight: 850,
  fontSize: 13,
};

const muted: React.CSSProperties = {
  color: "#64748b",
  fontSize: 12,
  lineHeight: 1.45,
};

const scrollList: React.CSSProperties = {
  display: "grid",
  gap: 8,
  maxHeight: 340,
  overflow: "auto",
  paddingRight: 4,
};

function detailText(details: unknown) {
  if (!details) return "";

  if (typeof details === "string") return details;

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function assetKindLabel(kind: SlideAssetOption["kind"]) {
  if (kind === "figure") return "FIGURE";
  if (kind === "equation") return "EQUATION";
  return "IMAGE";
}

function loadCustomInstructionPresets(): InstructionPreset[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(INSTRUCTION_PRESET_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        id: String(item.id ?? ""),
        title: String(item.title ?? ""),
        instruction: String(item.instruction ?? ""),
        builtin: false,
      }))
      .filter(
        (item) => item.id && item.title.trim() && item.instruction.trim()
      );
  } catch {
    return [];
  }
}

function saveCustomInstructionPresets(presets: InstructionPreset[]) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    INSTRUCTION_PRESET_STORAGE_KEY,
    JSON.stringify(
      presets.map((preset) => ({
        id: preset.id,
        title: preset.title,
        instruction: preset.instruction,
      }))
    )
  );
}

function makePresetId() {
  return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SlideGenerationClient({ meetings, assets }: Props) {
  const [targets, setTargets] = useState<SlideTarget[]>([]);
  const [targetPageId, setTargetPageId] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [freeformMaterial, setFreeformMaterial] = useState("");
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<string[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedExamples, setSelectedExamples] = useState<
    NotionSlideListItem[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [customInstructionPresets, setCustomInstructionPresets] = useState<
    InstructionPreset[]
  >([]);
  const [selectedInstructionPresetId, setSelectedInstructionPresetId] =
    useState("");
  const [newPresetTitle, setNewPresetTitle] = useState("");
  const [showPresetEditor, setShowPresetEditor] = useState(false);

  useEffect(() => {
    setCustomInstructionPresets(loadCustomInstructionPresets());
  }, []);

  const instructionPresets = useMemo(
    () => [...BUILTIN_INSTRUCTION_PRESETS, ...customInstructionPresets],
    [customInstructionPresets]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      const res = await fetch("/api/notion/slide-targets");
      const data = await res.json();

      if (cancelled) return;

      if (res.ok && data.targets?.length) {
        setTargets(data.targets);
        setTargetPageId(data.targets[0].pageId);
      }
    }

    loadTargets().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleAssets = useMemo(() => {
    if (selectedMeetingIds.length === 0) return [];

    const meetingSet = new Set(selectedMeetingIds);

    return assets.filter((asset) => meetingSet.has(asset.meetingId));
  }, [assets, selectedMeetingIds]);

  function toggleMeeting(meetingId: string) {
    setSelectedMeetingIds((prev) =>
      prev.includes(meetingId)
        ? prev.filter((id) => id !== meetingId)
        : [...prev, meetingId]
    );

    setSelectedAssetIds((prev) => {
      const nextMeetingIds = selectedMeetingIds.includes(meetingId)
        ? selectedMeetingIds.filter((id) => id !== meetingId)
        : [...selectedMeetingIds, meetingId];

      const allowedMeetingSet = new Set(nextMeetingIds);
      const allowedAssetIds = new Set(
        assets
          .filter((asset) => allowedMeetingSet.has(asset.meetingId))
          .map((asset) => asset.assetId)
      );

      return prev.filter((assetId) => allowedAssetIds.has(assetId));
    });
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId)
        ? prev.filter((id) => id !== assetId)
        : [...prev, assetId]
    );
  }

  function applyInstructionPreset(presetId: string) {
    setSelectedInstructionPresetId(presetId);

    const preset = instructionPresets.find((item) => item.id === presetId);
    if (!preset) return;

    setInstruction(preset.instruction);
  }

  function saveCurrentInstructionAsPreset() {
    const presetTitle = newPresetTitle.trim();
    const body = instruction.trim();

    if (!presetTitle || !body) return;

    const nextPresets = [
      ...customInstructionPresets,
      {
        id: makePresetId(),
        title: presetTitle,
        instruction: body,
        builtin: false,
      },
    ];

    setCustomInstructionPresets(nextPresets);
    saveCustomInstructionPresets(nextPresets);
    setNewPresetTitle("");
    setShowPresetEditor(false);
  }

  function deleteCustomInstructionPreset(presetId: string) {
    const nextPresets = customInstructionPresets.filter(
      (preset) => preset.id !== presetId
    );

    setCustomInstructionPresets(nextPresets);
    saveCustomInstructionPresets(nextPresets);

    if (selectedInstructionPresetId === presetId) {
      setSelectedInstructionPresetId("");
    }
  }

  async function generateSlide() {
    setBusy(true);
    setError("");
    setResult(null);

    try {
      const notionSlidePathMap = Object.fromEntries(
        selectedExamples.map((slide) => [slide.pageId, slide.path])
      );

      const res = await fetch("/api/notion/slide-generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          instruction,
          targetPageId,
          meetingIds: selectedMeetingIds,
          assetIds: selectedAssetIds,
          exampleSlidePageIds: selectedExamples.map((slide) => slide.pageId),
          exampleSlidePathMap: notionSlidePathMap,
          freeformMaterial,
        }),
      });

      const data: GenerateResponse = await res.json();

      if (!res.ok || data.error) {
        throw new Error(
          `${data.error ?? "slide generation failed"} ${detailText(
            data.details
          )}`.trim()
        );
      }

      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate slide page"
      );
    } finally {
      setBusy(false);
    }
  }

  const canGenerate =
    title.trim().length > 0 &&
    instruction.trim().length > 0 &&
    targetPageId.length > 0 &&
    (selectedMeetingIds.length > 0 ||
      selectedAssetIds.length > 0 ||
      freeformMaterial.trim().length > 0);

  return (
    <div style={pageWrap}>
      <div style={shell}>
        <div style={{ marginBottom: 24 }}>
          <div
            className="mono"
            style={{
              fontSize: 12,
              color: "#64748b",
              fontWeight: 800,
              marginBottom: 9,
            }}
          >
            NOTION SLIDE GENERATION
          </div>

          <h1
            style={{
              fontSize: 28,
              margin: 0,
              letterSpacing: "-.03em",
              color: "#111827",
            }}
          >
            Slide Generation
          </h1>

          <p style={{ ...muted, marginTop: 8, maxWidth: 760 }}>
            Generate a Notion slide-like page from selected meetings, visual
            assets, equations, and slide examples.
          </p>
        </div>

        <div style={grid}>
          <div style={{ display: "grid", gap: 20 }}>
            <section style={card}>
              <div style={cardHead}>
                <div>
                  <div style={{ fontWeight: 850 }}>Generation request</div>
                  <div style={muted}>
                    Output parent, title, and slide instruction
                  </div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "#aab2c0" }}
                >
                  REQUEST
                </span>
              </div>

              <div style={body}>
                <div>
                  <label style={label}>Output parent</label>
                  <select
                    value={targetPageId}
                    onChange={(e) => setTargetPageId(e.target.value)}
                    style={input}
                  >
                    {targets.map((target) => (
                      <option key={target.pageId} value={target.pageId}>
                        {target.path}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={label}>Slide page title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Function-aware feedback for tool-using RAG"
                    style={input}
                  />
                </div>

                <div>
                  <label style={label}>Instruction</label>

                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      marginBottom: 8,
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      background: "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <select
                        value={selectedInstructionPresetId}
                        onChange={(e) => applyInstructionPreset(e.target.value)}
                        style={input}
                      >
                        <option value="">Select instruction preset...</option>

                        <optgroup label="Built-in">
                          {BUILTIN_INSTRUCTION_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.title}
                            </option>
                          ))}
                        </optgroup>

                        {customInstructionPresets.length > 0 && (
                          <optgroup label="Custom">
                            {customInstructionPresets.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={() => setShowPresetEditor((value) => !value)}
                        style={{
                          border: "1px solid #cbd5e1",
                          background: "#fff",
                          color: "#111827",
                          borderRadius: 9,
                          padding: "9px 10px",
                          fontWeight: 850,
                          fontSize: 12,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {showPresetEditor ? "Close" : "Save preset"}
                      </button>
                    </div>

                    {showPresetEditor && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <input
                          value={newPresetTitle}
                          onChange={(e) => setNewPresetTitle(e.target.value)}
                          placeholder="Preset name"
                          style={input}
                        />

                        <button
                          type="button"
                          onClick={saveCurrentInstructionAsPreset}
                          disabled={!newPresetTitle.trim() || !instruction.trim()}
                          style={{
                            ...button,
                            padding: "9px 10px",
                            fontSize: 12,
                            opacity:
                              newPresetTitle.trim() && instruction.trim()
                                ? 1
                                : 0.55,
                            cursor:
                              newPresetTitle.trim() && instruction.trim()
                                ? "pointer"
                                : "not-allowed",
                          }}
                        >
                          Add
                        </button>
                      </div>
                    )}

                    {customInstructionPresets.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        {customInstructionPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() =>
                              deleteCustomInstructionPreset(preset.id)
                            }
                            title={`Delete ${preset.title}`}
                            style={{
                              border: "1px solid #fecaca",
                              background: "#fef2f2",
                              color: "#991b1b",
                              borderRadius: 999,
                              padding: "4px 8px",
                              fontSize: 11.5,
                              fontWeight: 750,
                              cursor: "pointer",
                            }}
                          >
                            Delete {preset.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="무슨 내용을 어떤 논지로 정리할지 적어줘."
                    style={textarea}
                  />
                </div>

                <div>
                  <label style={label}>Optional material</label>
                  <textarea
                    value={freeformMaterial}
                    onChange={(e) => setFreeformMaterial(e.target.value)}
                    placeholder="추가로 넣고 싶은 문장, bullet, claim, caveat 등"
                    style={{ ...textarea, minHeight: 90 }}
                  />
                </div>
              </div>
            </section>

            <section style={card}>
              <div style={cardHead}>
                <div>
                  <div style={{ fontWeight: 850 }}>Related meetings</div>
                  <div style={muted}>Text context source</div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "#aab2c0" }}
                >
                  MEETINGS
                </span>
              </div>

              <div style={{ ...body, paddingTop: 12 }}>
                <div style={scrollList}>
                  {meetings.map((meeting) => {
                    const selected = selectedMeetingIds.includes(meeting.id);

                    return (
                      <label
                        key={meeting.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "18px minmax(0, 1fr)",
                          gap: 10,
                          padding: 11,
                          borderRadius: 10,
                          border: selected
                            ? "1px solid #93c5fd"
                            : "1px solid #e5e7eb",
                          background: selected ? "#eff6ff" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMeeting(meeting.id)}
                        />

                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 800,
                              color: "#1f2937",
                              fontSize: 13,
                              lineHeight: 1.35,
                            }}
                          >
                            {meeting.date} · {meeting.title}
                          </div>

                          <div style={{ ...muted, marginTop: 3 }}>
                            {meeting.projectTag} ·{" "}
                            {meeting.participants.join(", ") || "No people"}
                          </div>

                          {meeting.summaryPreview && (
                            <div
                              style={{
                                ...muted,
                                marginTop: 6,
                                color: "#475569",
                              }}
                            >
                              {meeting.summaryPreview}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>

            <section style={card}>
              <div style={cardHead}>
                <div>
                  <div style={{ fontWeight: 850 }}>Assets</div>
                  <div style={muted}>
                    Selected assets can be inserted into the generated page
                  </div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "#aab2c0" }}
                >
                  ASSETS
                </span>
              </div>

              <div style={{ ...body, paddingTop: 12 }}>
                {selectedMeetingIds.length === 0 && (
                  <div style={{ ...muted, textAlign: "center", padding: 18 }}>
                    Select related meetings first.
                  </div>
                )}

                {selectedMeetingIds.length > 0 && visibleAssets.length === 0 && (
                  <div style={{ ...muted, textAlign: "center", padding: 18 }}>
                    No visual or equation assets found for selected meetings.
                  </div>
                )}

                {visibleAssets.length > 0 && (
                  <div style={scrollList}>
                    {visibleAssets.map((asset) => {
                      const selected = selectedAssetIds.includes(asset.assetId);

                      return (
                        <label
                          key={asset.assetId}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "18px minmax(0, 1fr)",
                            gap: 10,
                            padding: 11,
                            borderRadius: 10,
                            border: selected
                              ? "1px solid #86efac"
                              : "1px solid #e5e7eb",
                            background: selected ? "#f0fdf4" : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAsset(asset.assetId)}
                          />

                          <div style={{ minWidth: 0 }}>
                            <div
                              className="mono"
                              style={{
                                fontSize: 10.5,
                                color: "#64748b",
                                fontWeight: 850,
                                marginBottom: 4,
                              }}
                            >
                              {assetKindLabel(asset.kind)}
                            </div>

                            <div
                              style={{
                                fontWeight: 850,
                                color: "#1f2937",
                                fontSize: 13,
                              }}
                            >
                              {asset.title}
                            </div>

                            <div style={{ ...muted, marginTop: 3 }}>
                              {asset.meetingLabel}
                            </div>

                            <div
                              style={{
                                ...muted,
                                marginTop: 6,
                                color: "#475569",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {asset.preview.slice(0, 260)}
                            </div>

                            {asset.url && (
                              <img
                                src={asset.url}
                                alt=""
                                style={{
                                  display: "block",
                                  marginTop: 9,
                                  width: "100%",
                                  maxHeight: 160,
                                  objectFit: "contain",
                                  borderRadius: 8,
                                  border: "1px solid #e5e7eb",
                                  background: "#f8fafc",
                                }}
                              />
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside style={{ display: "grid", gap: 20 }}>
            <NotionSlideContextPicker
              title="Good slide examples"
              description="생성할 Notion slide page의 구성과 문체 reference로 사용합니다."
              onChange={setSelectedExamples}
            />

            <section style={card}>
              <div style={cardHead}>
                <div>
                  <div style={{ fontWeight: 850 }}>Generate</div>
                  <div style={muted}>Create a new Notion page</div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "#aab2c0" }}
                >
                  RUN
                </span>
              </div>

              <div style={body}>
                <div
                  style={{
                    padding: 11,
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    background: "#f8fafc",
                    display: "grid",
                    gap: 5,
                    fontSize: 12.5,
                    color: "#334155",
                  }}
                >
                  <div>Meetings: {selectedMeetingIds.length}</div>
                  <div>Assets: {selectedAssetIds.length}</div>
                  <div>Examples: {selectedExamples.length}</div>
                </div>

                {error && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 9,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "#991b1b",
                      fontSize: 12.5,
                      lineHeight: 1.45,
                    }}
                  >
                    {error}
                  </div>
                )}

                {result?.ok && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 9,
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      color: "#166534",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ fontWeight: 850 }}>Slide page created</div>
                    <div style={{ marginTop: 4 }}>
                      Target: {result.targetPath ?? "Slides"}
                    </div>
                    <div>
                      Blocks: {result.stats?.blocks ?? 0} · Assets:{" "}
                      {result.stats?.assets ?? 0}
                    </div>

                    {result.url && (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-block",
                          marginTop: 7,
                          color: "#166534",
                          fontWeight: 850,
                          textDecoration: "none",
                        }}
                      >
                        Open in Notion →
                      </a>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={generateSlide}
                  disabled={!canGenerate || busy}
                  style={{
                    ...button,
                    opacity: !canGenerate || busy ? 0.55 : 1,
                    cursor: !canGenerate || busy ? "not-allowed" : "pointer",
                  }}
                >
                  {busy ? "Generating..." : "Generate Notion Slide"}
                </button>

                <div style={muted}>
                  Duplicate page titles are blocked. The model can only insert
                  assets selected here.
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}