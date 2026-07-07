import type { InstructionPreset } from "./types";
import { researchProgressPreset } from "./researchProgress";
import { experimentReportPreset } from "./experimentReport";
import { paperReportPreset } from "./paperReport";
import { theoreticalPreset } from "./theoretical";

export type { InstructionPreset };

export const BUILTIN_INSTRUCTION_PRESETS: InstructionPreset[] = [
  researchProgressPreset,
  experimentReportPreset,
  paperReportPreset,
  theoreticalPreset,
];
