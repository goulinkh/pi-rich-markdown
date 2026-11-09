// Tells the model what this terminal can render. Fixed text per terminal
// kind, so the section stays in the prompt cache.

const DIAGRAMS = [
  "- Mermaid renders as diagrams: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, xychart-beta (other types show as code).",
  "- $$ … $$ renders as typeset math.",
];

/** The <rendering> prompt section; diagrams and math only when images work. */
export function renderingSection({ images }) {
  return [
    "This terminal renders Markdown richly.",
    ...(images ? DIAGRAMS : []),
    "- Tables, task lists and callouts (> [!NOTE], [!TIP], [!WARNING]…) render cleanly.",
    images
      ? "Use a diagram when it is clearer than prose; never draw ASCII-art diagrams. Keep tables narrow."
      : "Keep tables narrow.",
  ].join("\n");
}
