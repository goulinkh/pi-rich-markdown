// Mermaid diagrams and display math drawn as Kitty images, through the shared
// KittyImageStore so they count against the same memory budget as every other
// image. Anything that fails falls back to text.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { renderMermaidSVG } from "beautiful-mermaid";
import { planImage } from "../graphics/kitty-images.mjs";
import { rasterizeSvg, svgNaturalSize } from "../graphics/rasterize.mjs";
import { resolveSvgCss } from "../graphics/svg-css.mjs";
import { addCard, diagramColors, haloText, strengthenStrokes } from "../graphics/diagram-theme.mjs";
import { colorHex, spacing } from "./style.mjs";

const require = createRequire(import.meta.url);
const HELVETICA = "/System/Library/Fonts/HelveticaNeue.ttc";
const FONT = existsSync(HELVETICA)
  ? { fontFiles: [HELVETICA], defaultFontFamily: "Helvetica Neue" }
  : { defaultFontFamily: "sans-serif" };

/** SVG cache: building an SVG (layout, typesetting) costs far more than looking it up. */
const svgCache = new Map();
function cachedSvg(key, build) {
  if (svgCache.has(key)) {
    const svg = svgCache.get(key);
    svgCache.delete(key);
    svgCache.set(key, svg);
    return svg;
  }
  const svg = build();
  svgCache.set(key, svg);
  if (svgCache.size > 64) svgCache.delete(svgCache.keys().next().value);
  return svg;
}

const owners = new WeakMap();
let nextOwner = 0;
function ownerKey(md, kind, source) {
  if (!owners.has(md)) owners.set(md, ++nextOwner);
  return `md:${owners.get(md)}:${kind}:${createHash("sha1").update(source).digest("hex").slice(0, 16)}`;
}

/** Colors for images, derived from the active pi theme. */
function palette(theme) {
  const c = theme.colors;
  return {
    panel: colorHex(c.toolPendingBg) ?? "#2c2f33",
    text: colorHex(c.text) ?? "#e6e6e6",
    accent: colorHex(c.accent) ?? colorHex(c.mdLink) ?? "#61afef",
  };
}

export function mermaidSvg(source, theme) {
  const p = palette(theme);
  return cachedSvg(`mermaid\0${p.panel}${p.text}${p.accent}\0${source}`, () => {
    const c = diagramColors({ background: p.panel, foreground: p.text, accent: p.accent });
    let svg = renderMermaidSVG(source, {
      bg: c.bg, fg: c.fg, accent: c.accent, line: c.line, muted: c.muted, surface: c.surface, border: c.border, transparent: true,
    });
    svg = svg.replace(/(--_group-hdr:\s*)[^;]+;/, `$1${c.groupHeader};`)
      .replace(/(--_inner-stroke:\s*)[^;]+;/, `$1${c.innerStroke};`)
      .replace(/(--_key-badge:\s*)[^;]+;/, `$1${c.keyBadge};`);
    svg = resolveSvgCss(svg, { "--bg": c.bg, "--fg": c.fg, "--accent": c.accent, "--line": c.line, "--muted": c.muted, "--surface": c.surface, "--border": c.border });
    if (FONT.fontFiles) svg = svg.replace(/'Inter', system-ui, sans-serif/g, "'Helvetica Neue', sans-serif");
    return addCard(haloText(strengthenStrokes(svg), c.card, { labelFill: c.muted }), c.card);
  });
}

let mathjax;
function typesetter() {
  if (mathjax) return mathjax;
  const { mathjax: mj } = require("mathjax-full/js/mathjax.js");
  const { TeX } = require("mathjax-full/js/input/tex.js");
  const { SVG } = require("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
  const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mj.document("", { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: "local" }) });
  mathjax = { adaptor, doc };
  return mathjax;
}

/**
 * TeX → SVG sized in pixels. `exPx` is the x-height of the terminal font in
 * device pixels, so formulas match the surrounding text.
 */
export function mathSvg(tex, theme, exPx) {
  const { text } = palette(theme);
  return cachedSvg(`math\0${text}\0${exPx}\0${tex}`, () => {
    const { adaptor, doc } = typesetter();
    const node = doc.convert(tex, { display: true });
    let svg = adaptor.innerHTML(node);
    if (/data-mjx-error|merror/.test(svg)) throw new Error("TeX error");
    const ex = (name) => Number.parseFloat(new RegExp(`\\s${name}="([\\d.]+)ex"`).exec(svg)?.[1] ?? "NaN");
    const w = ex("width") * exPx, h = ex("height") * exPx;
    if (!(w > 0 && h > 0)) throw new Error("no size");
    svg = svg.replace(/\swidth="[\d.]+ex"/, ` width="${w.toFixed(1)}"`).replace(/\sheight="[\d.]+ex"/, ` height="${h.toFixed(1)}"`);
    if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    return svg.replace(/currentColor/g, text);
  });
}

/**
 * Lines for an image block: rows-1 blank lines, then the image drawn from the
 * last line upward (the way pi's Image component places images).
 */
export function imageLines(md, ctx, { kind, source, svg, maxColumns, maxRows, nextTokenType, center = false, scale = 1 }) {
  const { tui, store, limits } = ctx;
  const cell = tui.getCellDimensions();
  const size = svgNaturalSize(svg);
  if (!size) throw new Error("SVG without a size");
  const natural = { widthPx: size.widthPx * scale, heightPx: size.heightPx * scale };
  const plan = planImage({ natural, maxColumns, maxRows, cell, density: limits.density, maxImageBytes: limits.maxImageBytes });
  const sequence = store.image(ownerKey(md, kind, source), plan, (p) => rasterizeSvg(svg, { ...p, ...FONT }));
  const indent = " ".repeat(md.paddingX + (center ? Math.max(0, (maxColumns - plan.columns) >> 1) : 0));
  const up = plan.rows > 1 ? `\x1b[${plan.rows - 1}A` : "";
  return [...Array.from({ length: plan.rows - 1 }, () => ""), indent + up + sequence, ...spacing(nextTokenType)];
}

/**
 * Scale from CSS pixels (diagram SVGs) to the terminal's device pixels, so
 * diagram text comes out the size of terminal text: a CSS line is ~18px tall.
 */
export function cssToDevice(tui) {
  return Math.max(1, tui.getCellDimensions().heightPx / 18);
}

/** x-height of the terminal font in device pixels (cells are about 2.1 x-heights tall). */
export function terminalExPx(tui) {
  return tui.getCellDimensions().heightPx * 0.47;
}
