export type MeetingMode =
  | "meeting"
  | "background"
  | "paper_reading"
  | "experiment"
  | "context";

export type MeetingModeOption = {
  value: MeetingMode;
  label: string;
  titlePrefix: string;
  description: string;
};

export const MEETING_MODE_OPTIONS: MeetingModeOption[] = [
  {
    value: "meeting",
    label: "Meeting",
    titlePrefix: "meeting",
    description: "실제 사람과의 미팅 로그",
  },
  {
    value: "background",
    label: "Background",
    titlePrefix: "background",
    description: "배경지식 서치와 개념 조사 정리",
  },
  {
    value: "paper_reading",
    label: "Paper reading",
    titlePrefix: "paper-reading",
    description: "논문 읽고 챗봇과 리뷰한 내용 정리",
  },
  {
    value: "experiment",
    label: "Experiment",
    titlePrefix: "experiment",
    description: "실험 설계, 실행, 결과, 실패, 후속 실험 정리",
  },
  {
    value: "context",
    label: "Context",
    titlePrefix: "context",
    description: "지금까지의 프로젝트 진행 맥락과 결정사항 정리",
  },
];

export function normalizeMeetingMode(value?: string | null): MeetingMode {
  if (
    value === "meeting" ||
    value === "background" ||
    value === "paper_reading" ||
    value === "experiment" ||
    value === "context"
  ) {
    return value;
  }

  return "meeting";
}

export function meetingModeOption(value?: string | null): MeetingModeOption {
  const mode = normalizeMeetingMode(value);

  return (
    MEETING_MODE_OPTIONS.find((option) => option.value === mode) ??
    MEETING_MODE_OPTIONS[0]
  );
}

export function meetingModeLabel(value?: string | null) {
  return meetingModeOption(value).label;
}

export function meetingModeTitlePrefix(value?: string | null) {
  return meetingModeOption(value).titlePrefix;
}
