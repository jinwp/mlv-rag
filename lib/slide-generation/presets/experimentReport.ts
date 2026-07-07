import type { InstructionPreset } from "./types";
import { NOTION_SLIDE_COMMON_RULES } from "./common";

export const experimentReportPreset: InstructionPreset = {
  id: "experiment-report",
  title: "Experiment report",
  description: "실험 세팅, 결과, 해석, 실패 케이스, 후속 실험 중심",
  builtin: true,
  instruction: `
${NOTION_SLIDE_COMMON_RULES}

Preset goal:
Create an experiment-report slide deck that makes the experimental evidence easy to inspect.

Content policy:
- Clearly state the experimental question.
- Separate setup, compared methods, metrics, and implementation details.
- Report the main results without overstating them.
- Explain what the result implies and what it does not imply.
- Include failure cases, abnormal behavior, or unreliable measurements when relevant.
- If commands, configs, or hyperparameters are important, summarize them compactly.
- Prefer selected figures, generated figures, equations, or OCR evidence when they directly support the result.
- Do not include every raw note. Keep the deck presentation-oriented.

Recommended flow:
# Experiment Question
---
# Setup
---
# Compared Conditions
---
# Main Results
---
# Interpretation
---
# Failure Cases
---
# Decision
---
# Next Experiments
`.trim(),
};
