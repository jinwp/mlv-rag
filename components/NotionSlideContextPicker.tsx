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
  border: "1px solid #e6e8ef",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
};

const mutedStyle: React.CSSProperties = {
  color: "#667085",
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #d0d5dd",
  borderRadius: 10,
  padding: "8px 12px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
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

export default function NotionSlideContextPicker({
  title = "Notion slide context",
  description = "체크한 Notion slide page를 rewrite 실행 시점에 직접 읽어 context로 사용합니다.",
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

  useEffect(() => {
    loadSlides();
  }, []);

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div style={mutedStyle}>{description}</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={buttonStyle}
            onClick={loadSlides}
            disabled={disabled || loadingTree}
          >
            {loadingTree ? "Loading..." : "Refresh"}
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

      {error && (
        <div
          style={{
            border: "1px solid #f4b4b4",
            background: "#fff5f5",
            color: "#b42318",
            borderRadius: 10,
            padding: 10,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ ...mutedStyle, marginBottom: 12 }}>
        Selected: {selectedIds.size} / Available: {flatSlides.length}
      </div>

      {loadingTree && flatSlides.length === 0 ? (
        <div style={mutedStyle}>Loading Notion slides...</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {groups.map((group) => (
            <div key={group.pageId}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                {group.title}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {group.slides.map((slide) => {
                  const selected = selectedIds.has(slide.pageId);

                  return (
                    <label
                      key={slide.pageId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: 10,
                        border: selected
                          ? "1px solid #9db2ff"
                          : "1px solid #eef0f4",
                        borderRadius: 10,
                        padding: 10,
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

                      <div>
                        <div style={{ fontWeight: 650 }}>
                          {slide.title}
                        </div>

                        <div style={mutedStyle}>{slide.path}</div>

                        {slide.lastEditedTime && (
                          <div style={mutedStyle}>
                            Last edited:{" "}
                            {formatEditedTime(slide.lastEditedTime)}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {ungroupedSlides.length > 0 && (
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                Ungrouped
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {ungroupedSlides.map((slide) => {
                  const selected = selectedIds.has(slide.pageId);

                  return (
                    <label
                      key={slide.pageId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: 10,
                        border: selected
                          ? "1px solid #9db2ff"
                          : "1px solid #eef0f4",
                        borderRadius: 10,
                        padding: 10,
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

                      <div>
                        <div style={{ fontWeight: 650 }}>
                          {slide.title}
                        </div>
                        <div style={mutedStyle}>{slide.path}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {!loadingTree && flatSlides.length === 0 && (
            <div style={mutedStyle}>
              No slide pages found under NOTION_SLIDES_PAGE_ID.
            </div>
          )}
        </div>
      )}

      {selectedSlides.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 650 }}>
            Selected slide references
          </summary>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {selectedSlides.map((slide) => (
              <div
                key={slide.pageId}
                style={{
                  border: "1px solid #eef0f4",
                  borderRadius: 10,
                  padding: 10,
                  background: "#fafafa",
                }}
              >
                <div style={{ fontWeight: 650 }}>{slide.title}</div>
                <div style={mutedStyle}>{slide.path}</div>
                <div style={mutedStyle}>pageId: {slide.pageId}</div>
                {slide.url && (
                  <a
                    href={slide.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13 }}
                  >
                    Open in Notion
                  </a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}