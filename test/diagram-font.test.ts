import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fitText, useFont } from "../src/markdown/diagram-font.mjs";
import { fontFamilies, terminalFontFamily } from "../src/graphics/terminal-font.mjs";

const box = (width: number, label: string) =>
  `<svg><rect x="0" y="0" width="${width}" height="40"/><text x="${width / 2}" y="20" text-anchor="middle" font-size="13" font-weight="500" dy="4.55">${label}</text></svg>`;

test("labels that fit their box keep their size", () => {
  assert.deepEqual(fitText(box(200, "short"), 0.6), { svg: box(200, "short"), grow: 1 });
});

test("a label too wide for its box shrinks all text, and the image grows back", () => {
  // 14 characters * 0.6em * 13px = 109px; the box leaves 100 - 13 = 87px.
  const { svg, grow } = fitText(box(100, "Load extension"), 0.6);
  const size = Number(/font-size="([\d.]+)"/.exec(svg)![1]);
  assert.ok(Math.abs(14 * 0.6 * size - 87) < 0.5);
  assert.ok(Math.abs(grow - 13 / size) < 1e-3);
  assert.match(svg, /dy="3\.6/, "the baseline shift shrinks with the text");
});

test("labels outside any shape do not constrain the fit", () => {
  const svg = `<svg><text x="50" y="20" text-anchor="middle" font-size="11">a very long sequence message label</text></svg>`;
  assert.equal(fitText(svg, 0.6).grow, 1);
});

test("labels in diamonds are held to beautiful-mermaid's width estimate", () => {
  const svg = `<svg><polygon points="100,0 200,50 100,100 0,50"/><text x="100" y="50" text-anchor="middle" font-size="13" font-weight="500">Needs tools?</text></svg>`;
  assert.ok(fitText(svg, 0.6).grow > 1);
});

test("proportional fonts are left alone", () => {
  assert.equal(fitText(box(10, "Load extension"), undefined).grow, 1);
});

test("the font replaces Inter and drops the web-font import", () => {
  const svg = useFont(`<style>@import url('https://fonts.googleapis.com/css2?family=Inter');text { font-family: 'Inter', system-ui, sans-serif; }</style>`, "Maple Mono NF");
  assert.equal(svg, `<style>text { font-family: 'Maple Mono NF', sans-serif; }</style>`);
});

test("Rex's font comes from its preferences; the environment overrides it", () => {
  const run = (cmd: string, args: string[]) => { assert.equal(cmd, "defaults"); assert.equal(args.at(-1), "Workspace.terminalFontName"); return "Maple Mono NF\n"; };
  assert.equal(terminalFontFamily({ env: { TERM_PROGRAM: "rex" }, platform: "darwin", run }), "Maple Mono NF");
  assert.equal(terminalFontFamily({ env: { TERM_PROGRAM: "kitty" }, platform: "darwin", run }), undefined);
  assert.equal(terminalFontFamily({ env: { TERM_PROGRAM: "rex", PI_RICH_MARKDOWN_FONT: "Iosevka" }, platform: "darwin", run }), "Iosevka");
});

test("family names are read from TrueType collections", { skip: !existsSync("/System/Library/Fonts/HelveticaNeue.ttc") }, () => {
  assert.deepEqual(fontFamilies("/System/Library/Fonts/HelveticaNeue.ttc"), ["Helvetica Neue"]);
});
