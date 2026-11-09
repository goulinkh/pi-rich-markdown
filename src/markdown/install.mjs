// Replace how pi-tui's Markdown component draws block tokens.
//
// pi has no API for this; extensions share pi's pi-tui module instance, so
// patching Markdown.prototype.renderToken changes every Markdown pi draws:
// assistant and user messages, thinking, summaries. Each block renderer may
// return undefined (or throw) to fall back to pi's own rendering.

import { renderCode, isClosedFence } from "./code.mjs";
import { renderTable } from "./table.mjs";
import { renderHeading, renderListBullets, renderQuote } from "./text-blocks.mjs";
import { cssToDevice, imageLines, mathSvg, mermaidSvg, terminalExPx } from "./images.mjs";

const PATCHED = Symbol.for("pi-rich-markdown.markdown");
const REQUIRED = ["renderToken", "renderInlineTokens", "wrapCellText", "getStylePrefix"];

/**
 * `getTheme()` returns pi's active Theme (ctx.ui.theme), or undefined before
 * the session starts; until then pi renders as usual.
 * Returns a function that restores pi's renderer.
 */
export function installMarkdownRenderer({ tui, getTheme, store, limits, onError = () => {}, getCellDimensions = tui.getCellDimensions }) {
  const proto = tui.Markdown.prototype;
  const missing = REQUIRED.filter((name) => typeof proto[name] !== "function");
  if (missing.length) throw new Error(`pi's Markdown component changed (missing ${missing.join(", ")}); keeping pi's renderer`);

  if (proto.renderToken[PATCHED]) {
    Object.assign(proto.renderToken[PATCHED], { getTheme, store, limits, onError, getCellDimensions });
    return proto.renderToken[PATCHED].restore;
  }
  const original = proto.renderToken;
  const state = { getTheme, store, limits, onError, getCellDimensions, depth: 0, restore: () => { proto.renderToken = original; } };

  function renderToken(token, width, nextTokenType, styleContext) {
    const fallback = () => original.call(this, token, width, nextTokenType, styleContext);
    const theme = state.getTheme();
    if (!theme) return fallback();
    const ctx = {
      tui,
      theme,
      store: state.store,
      limits: state.limits,
      cell: state.getCellDimensions(),
      visibleWidth: tui.visibleWidth,
      wrap: (text, w) => tui.wrapTextWithAnsi(text, Math.max(1, w)),
      truncate: (text, w) => tui.truncateToWidth(text, w),
      strip: (text) => tui.stripTerminalSequences(text),
      topLevel: state.depth === 0,
    };
    state.depth++;
    try {
      return draw(state, this, ctx, token, width, nextTokenType, styleContext, fallback) ?? fallback();
    } catch (error) {
      state.onError(error, token);
      return fallback();
    } finally {
      state.depth--;
    }
  }
  renderToken[PATCHED] = state;
  proto.renderToken = renderToken;
  return state.restore;
}

function draw(state, md, ctx, token, width, nextTokenType, styleContext, fallback) {
  switch (token.type) {
    case "heading":
      return renderHeading(md, ctx, token, width, nextTokenType);
    case "table":
      return renderTable(md, ctx, token, width, nextTokenType, styleContext);
    case "blockquote":
      return renderQuote(md, ctx, token, width, nextTokenType, styleContext, fallback);
    case "list":
      return renderListBullets(md, ctx, fallback());
    case "code":
      if (isMermaid(token) && imagesAllowed(ctx) && isClosedFence(token)) {
        try {
          return imageLines(md, ctx, {
            kind: "mermaid", source: token.text, svg: mermaidSvg(token.text, ctx.theme),
            maxColumns: width, maxRows: 40, nextTokenType, scale: cssToDevice(ctx.cell),
          });
        } catch (error) {
          state.onError(error, token);
        }
      }
      return renderCode(md, ctx, token, width, nextTokenType);
    case "latexBlock":
      if (!token.pending && imagesAllowed(ctx)) {
        try {
          return imageLines(md, ctx, {
            kind: "math", source: token.text, svg: mathSvg(token.text, ctx.theme, terminalExPx(ctx.cell) * 1.15),
            maxColumns: width, maxRows: 12, nextTokenType, center: true,
          });
        } catch {
          // Unknown macros and the like: pi's Unicode rendering.
        }
      }
      return undefined;
    default:
      return undefined;
  }
}

function isMermaid(token) {
  return token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid";
}

/** Images only at the top level (lists and quotes re-wrap their lines) and on Kitty terminals. */
function imagesAllowed(ctx) {
  return ctx.topLevel && ctx.tui.getCapabilities().images === "kitty";
}
