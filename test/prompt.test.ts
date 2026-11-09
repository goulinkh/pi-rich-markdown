import { test } from "node:test";
import assert from "node:assert/strict";
import { renderingSection } from "../src/prompt.mjs";

test("with Kitty images the section offers diagrams and math", () => {
  const text = renderingSection({ images: true });
  assert.match(text, /sequenceDiagram/);
  assert.match(text, /\$\$/);
  assert.ok(text.length < 600, `short: ${text.length} chars`);
});

test("without images it only mentions what renders as text", () => {
  const text = renderingSection({ images: false });
  assert.doesNotMatch(text, /Mermaid|\$\$|diagram/i);
  assert.match(text, /callouts/);
});
