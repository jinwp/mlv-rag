"use client";

import {
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  useState,
} from "react";
import type { Meeting, Note, Transcript } from "@/lib/types";
import { TranscriptRefinePanel } from "@/components/TranscriptRefinePanel";
import NotionSlideContextPicker, {
  NotionSlideListItem,
} from "@/components/NotionSlideContextPicker";

type SummaryPanelInjectedProps = {
  selectedNotionSlides?: NotionSlideListItem[];
};

type Props = {
  meeting: Meeting;
  notes: Note[];
  transcripts: Transcript[];
  summaryPanel: ReactNode;
  rightRailChildren: ReactNode;
  photoPanel: ReactNode;
};

const mainGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 370px",
  gap: 20,
  alignItems: "start",
};

const leftColumn: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const rightRail: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const contextLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#3a4252",
  letterSpacing: ".02em",
  textTransform: "uppercase",
  marginBottom: -10,
};

export function MeetingDetailWorkspace({
  meeting,
  notes,
  transcripts,
  summaryPanel,
  rightRailChildren,
  photoPanel,
}: Props) {
  const [selectedNotionSlides, setSelectedNotionSlides] = useState<
    NotionSlideListItem[]
  >([]);

  const summaryPanelWithContext = isValidElement(summaryPanel)
    ? cloneElement(summaryPanel as ReactElement<SummaryPanelInjectedProps>, {
        selectedNotionSlides,
      })
    : summaryPanel;

  return (
    <>
      <div style={mainGrid}>
        <div style={leftColumn}>
          <TranscriptRefinePanel
            meeting={meeting}
            notes={notes}
            transcripts={transcripts}
            selectedNotionSlides={selectedNotionSlides}
          />

          {summaryPanelWithContext}
        </div>

        <div style={rightRail}>
          <div style={contextLabel}>External context</div>

          <NotionSlideContextPicker
            title="Slide context"
            description="선택한 Notion slide는 rewrite와 summary 실행 시점마다 서버가 직접 다시 읽습니다."
            onChange={setSelectedNotionSlides}
          />

          <div style={contextLabel}>Meeting context</div>

          {rightRailChildren}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>{photoPanel}</div>
    </>
  );
}