// Code blocks as a tinted panel: no ``` fences, the language as a quiet label,
// half-block edges so the panel reads as one shape. Long lines wrap with a
// continuation mark instead of breaking the panel.

import { hardWrap, keepBackground, spacing } from "./style.mjs";
import { linkify } from "../links/linkify.mjs";

const PANEL = "toolPendingBg";

export function renderCode(md, ctx, token, width, nextTokenType) {
  const { theme, visibleWidth } = ctx;
  if (width < 8) return undefined;
  const bg = theme.getBgAnsi(PANEL);
  const panelColor = theme.colors[PANEL];
  const inner = width - 2;
  const row = (content = "") => {
    const text = keepBackground(content, bg);
    return `${bg} ${text}${bg}${" ".repeat(Math.max(0, inner - visibleWidth(content)))} \x1b[49m`;
  };
  const edge = (glyph) => theme.style(glyph.repeat(width), { fg: panelColor });

  const lines = [edge("▄")];
  const lang = token.lang?.trim().split(/\s+/, 1)[0];
  if (lang) lines.push(row(theme.fg("dim", theme.italic(lang))));
  const links = ctx.tui?.getCapabilities?.().hyperlinks;
  for (const highlightedLine of highlighted(md, token)) {
    // URLs become hyperlinks, so a wrapped one opens whole from any of its rows.
    const codeLine = links ? linkify(highlightedLine) : highlightedLine;
    const [first, ...rest] = hardWrap(codeLine, inner, visibleWidth);
    lines.push(row(first));
    if (rest.length) {
      for (const part of hardWrap(rest.join(""), inner - 2, visibleWidth)) lines.push(row(theme.fg("dim", "↪ ") + part));
    }
  }
  lines.push(edge("▀"));
  return [...lines, ...spacing(nextTokenType)];
}

/** pi's own highlighting (cached per block the same way pi caches it). */
function highlighted(md, token) {
  const theme = md.theme;
  if (!theme.highlightCode) return token.text.split("\n").map((l) => theme.codeBlock(l));
  const key = `${token.lang ?? ""}\0${token.text}`;
  let lines = md.blockHighlightedCode?.get(key);
  if (!lines) {
    lines = theme.highlightCode(token.text, token.lang);
    md.blockHighlightedCode?.set(key, lines);
  }
  return lines;
}

/** A fenced block whose closing fence has arrived (pi re-renders while streaming). */
export function isClosedFence(token) {
  const raw = token.raw.trimEnd();
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1];
  return !!open && raw.length > open.length && raw.endsWith(open[0].repeat(open.length)) && raw.split("\n").length > 1;
}
