"use client";

import { useMemo, useState } from "react";

type Props = {
  text: string;
  maxChars?: number;
  collapsedLabel?: string;
  expandedLabel?: string;
  style?: React.CSSProperties;
};

const defaultBox: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  margin: 0,
  padding: 14,
  borderRadius: 10,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  fontSize: 13,
  lineHeight: 1.6,
};

const toggleButton: React.CSSProperties = {
  marginTop: 8,
  border: "1px solid #cfd7e3",
  background: "#fff",
  borderRadius: 8,
  padding: "5px 9px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

export function CollapsibleText({
  text,
  maxChars = 1200,
  collapsedLabel = "Show more",
  expandedLabel = "Show less",
  style,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const cleaned = text?.trim() ?? "";
  const shouldCollapse = cleaned.length > maxChars;

  const visibleText = useMemo(() => {
    if (!shouldCollapse || expanded) return cleaned;
    return `${cleaned.slice(0, maxChars).trimEnd()}\n...`;
  }, [cleaned, expanded, maxChars, shouldCollapse]);

  if (!cleaned) return null;

  return (
    <div>
      <pre style={{ ...defaultBox, ...style }}>{visibleText}</pre>
      {shouldCollapse && (
        <button
          type="button"
          style={toggleButton}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? expandedLabel : collapsedLabel}
        </button>
      )}
    </div>
  );
}