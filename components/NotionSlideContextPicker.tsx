"use client";

import { useEffect, useMemo, useState } from "react";

export type NotionSlideListItem = {
  pageId: string;
  title: string;
  path: string;
  url: string | null;
  groupTitle: string | null;
  groupPageId: string | null;
  lastEditedTime: string | null;
};

type SlideGroup = {
  pageId: string;
  title: string;
  url: string | null;
  slides: NotionSlideListItem[];
};

type SlidesResponse = {
  ok: boolean;
  groups: SlideGroup[];
  ungroupedSlides: NotionSlideListItem[];
  flatSlides: NotionSlideListItem[];
  error?: string;
  detail?: string;
};

type Props = {
  title?: string;
  description?: string;
  disabled?: boolean;
  onChange?: (selectedSlides: NotionSlideListItem[]) => void;
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e4e8ef",
  borderRadius: 13,
  background: "#fff",
  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
  overflow: "hidden",
};

const cardHead: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  padding: "13px 16px",
  borderBottom: "1px solid #eceff4",
  background: "#fafbfd",
};

const mutedStyle: React.CSSProperties = {
  color: "#667085",
  fontSize: 12,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #d0d5dd",
  borderRadius: 8,
  padding: "6px 9px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const groupBox: React.CSSProperties = {
  border: "1px solid #e7ebf2",
  borderRadius: 11,
  background: "#fff",
  overflow: "hidden",
};

const groupSummary: React.CSSProperties = {
  cursor: "pointer",
  listStyle: "none",
  padding: "10px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #eef2f7",
};

const slideCardBase: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: 9,
  borderRadius: 9,
  padding: "9px 10px",
  cursor: "pointer",
};

function formatEditedTime(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} KST`;
}

function selectedCountForGroup(
  slides: NotionSlideListItem[],
  selectedIds: Set<string>
) {
  return slides.filter((slide) => selectedIds.has(slide.pageId)).length;
}

export default function NotionSlideContextPicker({
  title = "Slide context",
  description = "선택한 Notion slide는 rewrite 실행 시점마다 서버가 직접 다시 읽습니다.",
  disabled = false,
  onChange,
}: Props) {
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<SlideGroup[]>([]);
  const [ungroupedSlides, setUngroupedSlides] = useState<
    NotionSlideListItem[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set()
  );

  const flatSlides = useMemo(() => {
    return [
      ...groups.flatMap((group) => group.slides),
      ...ungroupedSlides,
    ];
  }, [groups, ungroupedSlides]);

  const selectedSlides = useMemo(() => {
    return flatSlides.filter((slide) => selectedIds.has(slide.pageId));
  }, [flatSlides, selectedIds]);

  useEffect(() => {
    onChange?.(selectedSlides);
  }, [selectedSlides, onChange]);

  async function loadSlides() {
    setLoadingTree(true);
    setError(null);

    try {
      const res = await fetch("/api/notion/slides", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await res.json()) as SlidesResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || "failed to load slides");
      }

      setGroups(data.groups ?? []);
      setUngroupedSlides(data.ungroupedSlides ?? []);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoadingTree(false);
    }
  }

  function toggleSlide(slide: NotionSlideListItem) {
    if (disabled) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (next.has(slide.pageId)) {
        next.delete(slide.pageId);
      } else {
        next.add(slide.pageId);
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectGroup(slides: NotionSlideListItem[]) {
    if (disabled) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      slides.forEach((slide) => next.add(slide.pageId));
      return next;
    });
  }

  function clearGroup(slides: NotionSlideListItem[]) {
    if (disabled) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      slides.forEach((slide) => next.delete(slide.pageId));
      return next;
    });
  }

  useEffect(() => {
    loadSlides();
  }, []);

function renderSlide(slide: NotionSlideListItem, index: number) {
  const selected = selectedIds.has(slide.pageId);

    return (
      <label
        key={`${slide.pageId}-${index}`}
        style={{
          ...slideCardBase,
          border: selected ? "1px solid #9db2ff" : "1px solid #eef2f7",
          background: selected ? "#f6f8ff" : "#fff",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={() => toggleSlide(slide)}
          style={{ marginTop: 3 }}
        />

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: "#1f2937",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {slide.title}
          </div>

          <div
            style={{
              ...mutedStyle,
              marginTop: 2,
              wordBreak: "break-word",
            }}
          >
            {slide.path}
          </div>

          {slide.lastEditedTime && (
            <div style={{ ...mutedStyle, marginTop: 2 }}>
              Last edited: {formatEditedTime(slide.lastEditedTime)}
            </div>
          )}

          {slide.url && (
            <a
              href={slide.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block",
                marginTop: 4,
                fontSize: 12,
                color: "#3550c7",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Open in Notion
            </a>
          )}
        </div>
      </label>
    );
  }

  return (
    <section style={cardStyle}>
      <div style={cardHead}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#3a4252" }}>
            {title}
          </div>
          <div style={{ ...mutedStyle, marginTop: 2 }}>{description}</div>
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          <button
            type="button"
            style={buttonStyle}
            onClick={loadSlides}
            disabled={disabled || loadingTree}
          >
            {loadingTree ? "Loading" : "Refresh"}
          </button>

          <button
            type="button"
            style={buttonStyle}
            onClick={clearSelection}
            disabled={disabled || selectedIds.size === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {error && (
          <div
            style={{
              border: "1px solid #f4b4b4",
              background: "#fff5f5",
              color: "#b42318",
              borderRadius: 10,
              padding: 10,
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        <div style={mutedStyle}>
          Selected: {selectedIds.size} / Available: {flatSlides.length}
        </div>

        {loadingTree && flatSlides.length === 0 ? (
          <div style={mutedStyle}>Loading Notion slides...</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {groups.map((group, groupIndex) => {
              const selectedCount = selectedCountForGroup(
                group.slides,
                selectedIds
              );

              return (
                <details key={group.pageId} style={groupBox}>
                  <summary style={groupSummary}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 13,
                            color: "#1f2937",
                            wordBreak: "break-word",
                          }}
                        >
                          {group.title}
                        </div>
                        <div style={mutedStyle}>
                          {selectedCount} selected / {group.slides.length}{" "}
                          slides
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flex: "none",
                        }}
                        onClick={(e) => e.preventDefault()}
                      >
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: "5px 7px",
                            fontSize: 11.5,
                          }}
                          disabled={disabled || group.slides.length === 0}
                          onClick={(e) => {
                            e.preventDefault();
                            selectGroup(group.slides);
                          }}
                        >
                          All
                        </button>

                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: "5px 7px",
                            fontSize: 11.5,
                          }}
                          disabled={disabled || selectedCount === 0}
                          onClick={(e) => {
                            e.preventDefault();
                            clearGroup(group.slides);
                          }}
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </summary>

                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                    }}
                  >
                    {group.slides.map((slide, index) => renderSlide(slide, index))}
                  </div>
                </details>
              );
            })}

            {ungroupedSlides.length > 0 && (
              <details style={groupBox}>
                <summary style={groupSummary}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: "#1f2937",
                        }}
                      >
                        Ungrouped
                      </div>
                      <div style={mutedStyle}>
                        {selectedCountForGroup(ungroupedSlides, selectedIds)}{" "}
                        selected / {ungroupedSlides.length} slides
                      </div>
                    </div>
                  </div>
                </summary>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: 10,
                  }}
                >
                  {ungroupedSlides.map((slide, index) =>
                    renderSlide(slide, index)
                  )}
                </div>
              </details>
            )}

            {!loadingTree && flatSlides.length === 0 && (
              <div style={mutedStyle}>
                No slide pages found under NOTION_SLIDES_PAGE_ID.
              </div>
            )}
          </div>
        )}

        {selectedSlides.length > 0 && (
          <details>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12.5,
                color: "#3550c7",
              }}
            >
              Selected slide references
            </summary>

            <div style={{ display: "grid", gap: 7, marginTop: 9 }}>
              {selectedSlides.map((slide, index) => (
                <div
                  key={`${slide.pageId}-${index}`}
                  style={{
                    border: "1px solid #eef2f7",
                    borderRadius: 9,
                    padding: 9,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {slide.title}
                  </div>
                  <div style={mutedStyle}>{slide.path}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}