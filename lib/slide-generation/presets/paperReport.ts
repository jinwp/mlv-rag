import type { InstructionPreset } from "./types";
import { NOTION_SLIDE_COMMON_RULES } from "./common";

export const paperReportPreset: InstructionPreset = {
  id: "paper-report",
  title: "Paper report",
  description: "논문 문제설정, 방법론, 실험, 한계, 프로젝트 연결 중심",
  builtin: true,
  instruction: `
${NOTION_SLIDE_COMMON_RULES}

Preset goal:
Create a paper-report slide deck that explains the paper in relation to our research.

Content policy:
- Start with the problem setting and the paper's core claim.
- Explain the method in concrete steps.
- Clarify whether the method uses training, prompting, retrieval, agents, tools, memory, or optimization.
- Summarize the experimental setup and benchmarks only as much as needed.
- Separate the authors' evidence from our interpretation.
- Include limitations, unclear points, and assumptions.
- Connect the paper to our current project direction.
- Avoid generic literature-review wording.

Recommended flow:
# Paper Thesis
---
# Problem Setting
---
# Method Overview
---
# Key Mechanism
---
# Experimental Evidence
---
# Limitations
---
# Relation to Our Project
---
# Follow-up Questions
`.trim(),
};
