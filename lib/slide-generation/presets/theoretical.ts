import type { InstructionPreset } from "./types";
import { NOTION_SLIDE_COMMON_RULES } from "./common";

export const theoreticalPreset: InstructionPreset = {
  id: "theoretical",
  title: "Theoretical formulation",
  description: "아이디어, 수식화, 배경 이론, 증명 스케치, 개념 분해 중심",
  builtin: true,
  instruction: `
${NOTION_SLIDE_COMMON_RULES}

Preset goal:
Create a theoretical slide deck that formulates an idea, background theory, or conceptual mechanism.

Content policy:
- Start from the motivating question or conceptual gap.
- Define key variables, objects, assumptions, and scope.
- Present the formulation step by step.
- Use equations only when they clarify the idea.
- Explain intuition before or after formal notation.
- Separate known background theory from the user's own hypothesis.
- Include proof sketches, counterexamples, or boundary cases when relevant.
- End with what should be verified experimentally or theoretically next.
- Do not over-compress dense theory into one slide.

Recommended flow:
# Motivating Question
---
# Objects and Assumptions
---
# Formulation
---
# Intuition
---
# Relation to Known Theory
---
# Consequences
---
# Open Problems
---
# What to Verify Next
`.trim(),
};
