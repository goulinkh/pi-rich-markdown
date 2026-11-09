// Tells the model what this terminal can render. Fixed text per terminal
// kind, so the section stays in the prompt cache.

const DIAGRAMS = [
  "- Mermaid renders as diagrams: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, xychart-beta (other types show as code).",
  "- $$ … $$ renders as typeset math.",
];

const ICONS = "- Nerd Font icons: write :nf-<set>-<name>: with official cheat-sheet names (e.g. :nf-md-check_circle:, :nf-dev-rust:, :nf-oct-git_branch:), sparingly, for status markers and to tag languages and tools. Chat replies only: never in files, code, commit messages or other tool input.";

/**
 * The <rendering> prompt section; diagrams and math only when images work,
 * icons only when the terminal can draw Nerd Font glyphs.
 */
export function renderingSection({ images, icons = false }) {
  return [
    "This terminal renders Markdown richly.",
    ...(images ? DIAGRAMS : []),
    "- Tables, task lists and callouts (> [!NOTE], [!TIP], [!WARNING]…) render cleanly.",
    ...(icons ? [ICONS] : []),
    images
      ? "Use a diagram when it is clearer than prose; never draw ASCII-art diagrams. Keep tables narrow."
      : "Keep tables narrow.",
  ].join("\n");
}
