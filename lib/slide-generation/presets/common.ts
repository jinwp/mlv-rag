export const NOTION_SLIDE_COMMON_RULES = `
You are writing a Notion slide-style document.

Common slide style:
- Use # for every slide title. Each slide must start with one clear H1 title.
- Separate slides with ---.
- Do not write toggles.
- Do not overuse bullet points. Use short paragraphs, compact numbered logic, or small bullet groups only when they improve readability.
- Do not pack too much content into one slide. Split dense content into multiple slides.
- Each slide should have one main message.
- Prefer presenter-facing clarity over archival completeness.
- Use selected images, equations, figures, or OCR evidence only when they directly support the slide message.
- Avoid generic filler slides.
- Avoid Markdown tables unless the user explicitly asks for a table.
`.trim();
