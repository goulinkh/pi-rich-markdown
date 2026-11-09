import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramColors, haloText, parseHex } from "../src/graphics/diagram-theme.mjs";

const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex).map((c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const [name, background, foreground] of [
  ["one dark", "#21252b", "#e6e6e6"],
  ["catppuccin", "#1e1e2e", "#cdd6f4"],
  ["light", "#fafafa", "#383a42"],
]) {
  test(`${name}: diagram parts stand out from the background`, () => {
    const c = diagramColors({ background, foreground });
    assert.ok(contrast(c.line, c.card) >= 3, `connectors ${c.line} on ${c.card}`);
    assert.ok(contrast(c.border, c.card) >= 2, `node border ${c.border} on ${c.card}`);
    assert.ok(contrast(c.muted, c.card) >= 4.5, `labels ${c.muted} on ${c.card}`);
    assert.ok(contrast(c.fg, c.surface) >= 7, `node text ${c.fg} on ${c.surface}`);
    assert.ok(contrast(c.surface, c.card) > 1.15, `node fill ${c.surface} on ${c.card}`);
  });
}

test("halo applies to labels only, not node text", () => {
  const svg = `<svg><text fill="#a9abad">answer</text><text fill="#e6e6e6">User</text></svg>`;
  const out = haloText(svg, "#282c32", { labelFill: "#a9abad" });
  assert.match(out, /<text paint-order="stroke"[^>]*fill="#a9abad">answer/);
  assert.match(out, /<text fill="#e6e6e6">User/);
});

test("halo skips labels that already sit on a badge", () => {
  const svg = `<svg><g class="edge-label" data-label="yes">\n  <rect x="1" fill="#fff" />\n  <text fill="#a9abad">yes</text>\n</g><text fill="#a9abad">answer</text></svg>`;
  const out = haloText(svg, "#eee", { labelFill: "#a9abad" });
  assert.match(out, /<text fill="#a9abad">yes/);
  assert.match(out, /<text paint-order="stroke"[^>]*>answer/);
});
