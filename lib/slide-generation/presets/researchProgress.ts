import type { InstructionPreset } from "./types";
import { NOTION_SLIDE_COMMON_RULES } from "./common";

export const researchProgressPreset: InstructionPreset = {
  id: "research-progress",
  title: "Research progress summary",
  description: "진행 중인 연구의 목표, 현재 상태, 발견, 문제, 다음 액션 중심",
  builtin: true,
  instruction: `
${NOTION_SLIDE_COMMON_RULES}

Preset goal:
Create a research-progress slide deck for an internal lab or advisor update.

Content policy:
- Start with the current research objective and why it matters.
- Explain the current pipeline or method only to the level needed to understand progress.
- Summarize what changed recently.
- Highlight key observations, partial evidence, and failure cases.
- Distinguish confirmed results from hypotheses.
- Make open questions and next actions explicit.
- Do not turn this into a full paper-style background section.
- Do not include raw transcript-like details unless they support a clear progress point.

Recommended flow:
# Current Goal
---
# Current Pipeline / Method
---
# What Changed Recently
---
# Key Observations
---
# Failure Cases or Bottlenecks
---
# Interpretation
---
# Next Actions
`.trim(),
};
