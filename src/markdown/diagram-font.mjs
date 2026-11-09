// Diagram text in the terminal's font.
//
// beautiful-mermaid sizes every box from a fixed width estimate tuned for a
// proportional font (Inter). A terminal font is monospace and wider, so labels
// would overflow their boxes. fitText shrinks all text of a diagram by one
// factor, just enough for the widest label to fit the space the layout gave
// it, and returns the inverse factor: scaling the image by it brings the text
// back to the terminal's text size.

import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { findFontFiles, terminalFontFamily } from "../graphics/terminal-font.mjs";

const HELVETICA = "/System/Library/Fonts/HelveticaNeue.ttc";
const UNUSED_WEIGHTS = /thin|hairline|light|extrabold|ultrabold|black|heavy/i;
const MIN_FIT = 0.6;

let cached;

/**
 * The font for diagram text: { family, fontFiles?, advance? }. `advance` is
 * the width of one character in em for a monospace font, measured once.
 */
export function diagramFont(options) {
  if (cached && !options) return cached;
  const family = terminalFontFamily(options);
  const files = family ? findFontFiles(family) : [];
  const used = files.filter((f) => !UNUSED_WEIGHTS.test(f.split("/").pop()));
  const font = files.length
    ? { family, fontFiles: used.length ? used : files }
    : existsSync(HELVETICA) ? { family: "Helvetica Neue", fontFiles: [HELVETICA] } : { family: "sans-serif" };
  font.advance = font.fontFiles && family === font.family ? monospaceAdvance(font) : undefined;
  if (!options) cached = font;
  return font;
}

/** Character width in em when every character has the same width, else undefined. */
function monospaceAdvance({ family, fontFiles }) {
  const width = (text) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200"><text x="10" y="150" font-family="${family}" font-size="100">${text}</text></svg>`;
    return new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: family } }).innerBBox()?.width ?? 0;
  };
  try {
    const narrow = (width("i".repeat(21)) - width("i")) / 2000;
    const wide = (width("M".repeat(21)) - width("M")) / 2000;
    return narrow > 0 && Math.abs(narrow - wide) < 0.01 ? (narrow + wide) / 2 : undefined;
  } catch {
    return undefined;
  }
}

/** Put the font into the SVG's styles. */
export function useFont(svg, family) {
  const name = `'${family.replace(/'/g, "")}'`;
  return svg
    .replace(/'Inter', system-ui, sans-serif/g, `${name}, sans-serif`)
    .replace(/'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace/g, `${name}, monospace`)
    .replace(/@import url\([^)]*fonts\.googleapis[^)]*\);?/g, "");
}

/**
 * Shrink every text of a diagram by one factor so each label fits the shape it
 * sits in. Returns { svg, grow }: draw the image `grow` times larger to keep
 * text at its intended size.
 *
 * Labels in rectangles, circles and ellipses get the shape's width minus half
 * an em on each side. Diamonds and hexagons were sized from beautiful-mermaid's
 * estimate, so their labels must not exceed it. Labels outside any shape
 * (sequence messages, edge text) are free.
 */
export function fitText(svg, advance) {
  if (!advance) return { svg, grow: 1 };
  const shapes = shapesOf(svg);
  let fit = 1;
  for (const [, attrs, body] of svg.matchAll(TEXT)) {
    const num = (name, fallback) => Number(new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(attrs)?.[1] ?? fallback);
    const x = num("x", NaN), y = num("y", NaN), size = num("font-size", 13), weight = num("font-weight", 400);
    const anchor = /text-anchor="(\w+)"/.exec(attrs)?.[1] ?? "start";
    const shape = shapes.filter((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
      .sort((a, b) => a.area - b.area)[0];
    if (!shape) continue;
    const pad = size / 2;
    const room = anchor === "middle" ? 2 * Math.min(x - shape.left, shape.right - x)
      : anchor === "end" ? x - shape.left : shape.right - x;
    for (const line of textLines(body)) {
      const actual = monoWidth(line) * advance * size;
      if (!actual) continue;
      const available = shape.estimated ? estimatedWidth(line, size, weight) : room * shape.usable - 2 * pad;
      fit = Math.min(fit, available / actual);
    }
  }
  fit = Math.max(MIN_FIT, fit);
  if (fit >= 0.999) return { svg, grow: 1 };
  const scaled = svg.replace(TEXT, (whole) =>
    whole.replace(/\b(font-size|dy)="(-?[\d.]+)"/g, (_, key, value) => `${key}="${+(Number(value) * fit).toFixed(3)}"`));
  return { svg: scaled, grow: 1 / fit };
}

/** Bounding boxes of the shapes labels can sit in. */
function shapesOf(svg) {
  const attr = (tag, name) => Number(new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(tag)?.[1]);
  const shapes = [];
  const add = (left, top, width, height, extra = {}) => {
    if (width >= 12 && height >= 8) shapes.push({ left, top, right: left + width, bottom: top + height, area: width * height, usable: 1, ...extra });
  };
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/g)) add(attr(tag, "x") || 0, attr(tag, "y") || 0, attr(tag, "width"), attr(tag, "height"));
  for (const [tag] of svg.matchAll(/<circle\b[^>]*>/g)) {
    const r = attr(tag, "r");
    add(attr(tag, "cx") - r, attr(tag, "cy") - r, 2 * r, 2 * r, { usable: 0.85 });
  }
  for (const [tag] of svg.matchAll(/<ellipse\b[^>]*>/g)) {
    const rx = attr(tag, "rx"), ry = attr(tag, "ry");
    add(attr(tag, "cx") - rx, attr(tag, "cy") - ry, 2 * rx, 2 * ry, { usable: 0.85 });
  }
  for (const [tag] of svg.matchAll(/<polygon\b[^>]*>/g)) {
    const points = (/points="([^"]*)"/.exec(tag)?.[1] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
    if (xs.length < 3) continue;
    const left = Math.min(...xs), top = Math.min(...ys);
    add(left, top, Math.max(...xs) - left, Math.max(...ys) - top, { estimated: true });
  }
  return shapes;
}

const TEXT = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

function textLines(body) {
  const lines = body.includes("<tspan") && /<tspan[^>]*\bx="/.test(body) ? body.split(/<tspan[^>]*\bx="[^"]*"[^>]*>/).filter((l) => l.trim()) : [body];
  return lines.map((l) => l.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
}

const WIDE_CHAR = /[\u1100-\u115f\u2e80-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;
const COMBINING = /\p{M}/u;

function monoWidth(text) {
  let n = 0;
  for (const ch of text) n += COMBINING.test(ch) ? 0 : WIDE_CHAR.test(ch) ? 2 : 1;
  return n;
}

// beautiful-mermaid 1.1's own estimate (measureTextWidth), which it does not export.
const NARROW = new Set("iltfjI1!|.,:;'");
const SEMI_NARROW = new Set("()[]{}/\\-\"`");
function estimatedWidth(text, size, weight) {
  const ratio = weight >= 600 ? 0.6 : weight >= 500 ? 0.57 : 0.54;
  let units = 0;
  for (const ch of text) {
    units += COMBINING.test(ch) ? 0 : WIDE_CHAR.test(ch) ? 2 : ch === " " ? 0.3 : ch === "W" || ch === "M" ? 1.5
      : "wm@%".includes(ch) ? 1.2 : NARROW.has(ch) ? 0.4 : SEMI_NARROW.has(ch) ? 0.5 : ch === "r" ? 0.8 : /[A-Z]/.test(ch) ? 1.2 : 1;
  }
  return units * size * ratio + size * 0.15;
}
