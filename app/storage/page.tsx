"use client";

import { useEffect, useMemo, useState } from "react";

type Category = "summary" | "audio" | "image" | "transcript" | "rag";
type SortMode = "recent" | "oldest" | "size_desc" | "size_asc" | "name";

type StorageItem = {
  id: string;
  category: Category;
  source: "storage" | "db";
  name: string;
  path: string | null;
  sizeBytes: number;
  updatedAt: string | null;
  detail: string;
};

type StorageGroup = {
  category: Category;
  count: number;
  totalBytes: number;
  items: StorageItem[];
};

type OverviewResponse = {
  bucket: string;
  capacityLimitBytes: number;
  totalBytes: number;
  groups: StorageGroup[];
};

const CATEGORY_META: Record<Category, { label: string; sub: string }> = {
  summary: {
    label: "Summary",
    sub: "meetings.summary_text",
  },
  audio: {
    label: "음성 파일",
    sub: "audio/video objects",
  },
  image: {
    label: "이미지 파일",
    sub: "photos/generated figures",
  },
  transcript: {
    label: "회의록",
    sub: "transcripts table",
  },
  rag: {
    label: "RAG",
    sub: "meeting_memory_chunks",
  },
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function formatDate(value: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sortItems(items: StorageItem[], sort: SortMode) {
  const copy = [...items];

  copy.sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name);
    }

    if (sort === "size_desc") {
      return b.sizeBytes - a.sizeBytes;
    }

    if (sort === "size_asc") {
      return a.sizeBytes - b.sizeBytes;
    }

    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;

    if (sort === "oldest") {
      return at - bt;
    }

    return bt - at;
  });

  return copy;
}

function percent(total: number, limit: number) {
  if (!limit) return 0;
  return Math.min(100, Math.max(0, (total / limit) * 100));
}

export default function StoragePage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyCategory, setBusyCategory] = useState<Category | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [open, setOpen] = useState<Record<Category, boolean>>({
    summary: false,
    audio: false,
    image: false,
    transcript: false,
    rag: false,
  });

  const [sort, setSort] = useState<Record<Category, SortMode>>({
    summary: "recent",
    audio: "recent",
    image: "recent",
    transcript: "recent",
    rag: "recent",
  });

  const [selected, setSelected] = useState<Record<Category, Set<string>>>({
    summary: new Set(),
    audio: new Set(),
    image: new Set(),
    transcript: new Set(),
    rag: new Set(),
  });

  useEffect(() => {
    void loadOverview();
  }, []);

  async function loadOverview() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/storage/overview", {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "failed to load storage overview");
      }

      setOverview(data);
      setSelected({
        summary: new Set(),
        audio: new Set(),
        image: new Set(),
        transcript: new Set(),
        rag: new Set(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load storage overview");
    } finally {
      setLoading(false);
    }
  }

  function groupOf(category: Category): StorageGroup {
    return (
      overview?.groups.find((group) => group.category === category) ?? {
        category,
        count: 0,
        totalBytes: 0,
        items: [],
      }
    );
  }

  function toggleItem(category: Category, id: string) {
    setSelected((prev) => {
      const nextSet = new Set(prev[category]);
      if (nextSet.has(id)) {
        nextSet.delete(id);
      } else {
        nextSet.add(id);
      }

      return {
        ...prev,
        [category]: nextSet,
      };
    });
  }

  function selectAllVisible(category: Category, ids: string[]) {
    setSelected((prev) => ({
      ...prev,
      [category]: new Set(ids),
    }));
  }

  function clearSelection(category: Category) {
    setSelected((prev) => ({
      ...prev,
      [category]: new Set(),
    }));
  }

  async function deleteItems(category: Category, deleteAll: boolean) {
    const ids = [...selected[category]];
    const meta = CATEGORY_META[category];

    if (!deleteAll && ids.length === 0) return;

    const ok = window.confirm(
      deleteAll
        ? `${meta.label} 전체를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
        : `${meta.label}에서 선택한 ${ids.length}개 항목을 삭제할까요?`
    );

    if (!ok) return;

    setBusyCategory(category);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/storage/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          ids,
          deleteAll,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail ?? data?.error ?? "delete failed");
      }

      setMessage(
        deleteAll
          ? `${meta.label} 전체 삭제 완료`
          : `${meta.label} 선택 항목 삭제 완료`
      );

      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusyCategory(null);
    }
  }

  const categories: Category[] = ["summary", "audio", "image", "transcript", "rag"];

  const totalPercent = overview
    ? percent(overview.totalBytes, overview.capacityLimitBytes)
    : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: "36px 30px 80px",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "#8a93a3",
                letterSpacing: ".04em",
                marginBottom: 6,
              }}
            >
              STORAGE MANAGER
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 750,
                letterSpacing: "-.02em",
              }}
            >
              Storage 모니터링 · 삭제 관리
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                color: "#64748b",
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              summary, 음성, 이미지, 회의록, RAG chunk의 용량을 확인하고 선택 삭제합니다.
            </p>
          </div>

          <button
            type="button"
            onClick={loadOverview}
            disabled={loading}
            style={{
              border: "1px solid #d8dee7",
              background: "#fff",
              color: "#3550c7",
              borderRadius: 9,
              padding: "9px 15px",
              fontSize: 13,
              fontWeight: 800,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.55 : 1,
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <section
          style={{
            background: "#fff",
            border: "1px solid #e4e8ef",
            borderRadius: 14,
            padding: 18,
            boxShadow: "0 1px 3px rgba(20,30,50,.04)",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#1f2937" }}>
                Total usage
              </div>
              <div className="mono" style={{ fontSize: 11, color: "#8a93a3", marginTop: 3 }}>
                bucket: {overview?.bucket ?? "—"}
              </div>
            </div>
            <div className="mono" style={{ fontSize: 13, color: "#475569" }}>
              {formatBytes(overview?.totalBytes ?? 0)} /{" "}
              {formatBytes(overview?.capacityLimitBytes ?? 500 * 1024 * 1024)}
            </div>
          </div>

          <div
            style={{
              height: 10,
              borderRadius: 20,
              background: "#e5e9f0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${totalPercent}%`,
                height: "100%",
                background:
                  totalPercent > 90
                    ? "#dc2626"
                    : totalPercent > 70
                      ? "#f59e0b"
                      : "#3550c7",
              }}
            />
          </div>

          <div
            className="mono"
            style={{ marginTop: 8, fontSize: 11, color: "#8a93a3" }}
          >
            {totalPercent.toFixed(1)}% used
          </div>
        </section>

        {message && (
          <div
            style={{
              marginBottom: 14,
              color: "#166534",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              marginBottom: 14,
              color: "#b91c1c",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {categories.map((category) => {
            const meta = CATEGORY_META[category];
            const group = groupOf(category);
            const sortedItems = sortItems(group.items, sort[category]);
            const selectedCount = selected[category].size;
            const isOpen = open[category];
            const isBusy = busyCategory === category;

            return (
              <section
                key={category}
                style={{
                  background: "#fff",
                  border: "1px solid #e4e8ef",
                  borderRadius: 14,
                  boxShadow: "0 1px 3px rgba(20,30,50,.04)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "16px 18px",
                    display: "grid",
                    gridTemplateColumns: "1fr 180px 170px",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpen((prev) => ({
                            ...prev,
                            [category]: !prev[category],
                          }))
                        }
                        style={{
                          border: "1px solid #d8dee7",
                          background: isOpen ? "#eef1fc" : "#fff",
                          color: "#3550c7",
                          borderRadius: 8,
                          width: 30,
                          height: 28,
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                      >
                        {isOpen ? "−" : "+"}
                      </button>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 850, color: "#1f2937" }}>
                          {meta.label}
                        </div>
                        <div className="mono" style={{ fontSize: 10.5, color: "#8a93a3", marginTop: 2 }}>
                          {meta.sub}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 13,
                        color: "#475569",
                        textAlign: "right",
                      }}
                    >
                      {formatBytes(group.totalBytes)}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        color: "#8a93a3",
                        textAlign: "right",
                        marginTop: 3,
                      }}
                    >
                      {group.count} items
                    </div>
                  </div>

                  <select
                    value={sort[category]}
                    onChange={(event) =>
                      setSort((prev) => ({
                        ...prev,
                        [category]: event.target.value as SortMode,
                      }))
                    }
                    style={{
                      width: "100%",
                      border: "1px solid #d8dee7",
                      borderRadius: 9,
                      padding: "8px 10px",
                      fontSize: 12.5,
                      background: "#fff",
                    }}
                  >
                    <option value="recent">최근순</option>
                    <option value="oldest">오래된순</option>
                    <option value="size_desc">용량 큰 순</option>
                    <option value="size_asc">용량 작은 순</option>
                    <option value="name">이름순</option>
                  </select>
                </div>

                <div
                  style={{
                    maxHeight: isOpen ? 520 : 0,
                    opacity: isOpen ? 1 : 0,
                    overflow: "hidden",
                    transition: "max-height .22s ease, opacity .15s ease",
                    borderTop: isOpen ? "1px solid #edf0f5" : "none",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 18px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      background: "#fbfcfe",
                      borderBottom: "1px solid #edf0f5",
                    }}
                  >
                    <div className="mono" style={{ fontSize: 11, color: "#64748b" }}>
                      selected: {selectedCount}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() =>
                          selectAllVisible(
                            category,
                            sortedItems.map((item) => item.id)
                          )
                        }
                        disabled={sortedItems.length === 0}
                        style={{
                          border: "1px solid #d8dee7",
                          background: "#fff",
                          color: "#475569",
                          borderRadius: 8,
                          padding: "7px 10px",
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: sortedItems.length ? "pointer" : "default",
                          opacity: sortedItems.length ? 1 : 0.5,
                        }}
                      >
                        Select all
                      </button>

                      <button
                        type="button"
                        onClick={() => clearSelection(category)}
                        disabled={selectedCount === 0}
                        style={{
                          border: "1px solid #d8dee7",
                          background: "#fff",
                          color: "#475569",
                          borderRadius: 8,
                          padding: "7px 10px",
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: selectedCount ? "pointer" : "default",
                          opacity: selectedCount ? 1 : 0.5,
                        }}
                      >
                        Clear
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteItems(category, false)}
                        disabled={selectedCount === 0 || isBusy}
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fff",
                          color: "#b91c1c",
                          borderRadius: 8,
                          padding: "7px 10px",
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: selectedCount && !isBusy ? "pointer" : "default",
                          opacity: selectedCount && !isBusy ? 1 : 0.5,
                        }}
                      >
                        Delete selected
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteItems(category, true)}
                        disabled={group.count === 0 || isBusy}
                        style={{
                          border: "none",
                          background: "#b91c1c",
                          color: "#fff",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 12,
                          fontWeight: 850,
                          cursor: group.count && !isBusy ? "pointer" : "default",
                          opacity: group.count && !isBusy ? 1 : 0.5,
                        }}
                      >
                        {isBusy ? "Deleting..." : "Delete all"}
                      </button>
                    </div>
                  </div>

                  <div style={{ maxHeight: 420, overflow: "auto" }}>
                    {sortedItems.length === 0 ? (
                      <div
                        style={{
                          padding: 24,
                          color: "#94a3b8",
                          fontSize: 13,
                          textAlign: "center",
                        }}
                      >
                        항목이 없습니다.
                      </div>
                    ) : (
                      sortedItems.map((item) => {
                        const checked = selected[category].has(item.id);

                        return (
                          <label
                            key={item.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "28px minmax(0, 1fr) 110px 160px",
                              gap: 10,
                              alignItems: "center",
                              padding: "10px 18px",
                              borderBottom: "1px solid #f0f2f6",
                              background: checked ? "#f8faff" : "#fff",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleItem(category, item.id)}
                            />

                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "#1f2937",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={item.name}
                              >
                                {item.name}
                              </div>
                              <div
                                className="mono"
                                style={{
                                  fontSize: 10.5,
                                  color: "#8a93a3",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  marginTop: 2,
                                }}
                                title={item.path ?? item.detail}
                              >
                                {item.path ?? item.detail}
                              </div>
                            </div>

                            <div
                              className="mono"
                              style={{ fontSize: 11.5, color: "#475569", textAlign: "right" }}
                            >
                              {formatBytes(item.sizeBytes)}
                            </div>

                            <div
                              className="mono"
                              style={{
                                fontSize: 10.5,
                                color: "#8a93a3",
                                textAlign: "right",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={formatDate(item.updatedAt)}
                            >
                              {formatDate(item.updatedAt)}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}