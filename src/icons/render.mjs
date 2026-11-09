// Draw :nf-…: shortcodes as Nerd Font glyphs, in the terminal only.
//
// Wraps Markdown.prototype.renderInlineTokens, so shortcodes are replaced in
// prose text tokens only: code spans, code blocks, link targets and escaped
// text (\:nf-md-check:) keep the literal text. Every inline caller goes
// through it (paragraphs, headings, list items, table cells, callouts), and
// widths are measured after the swap, so tables stay aligned.

import { iconize } from "./nerd-fonts.mjs";

const PATCHED = Symbol.for("pi-rich-markdown.icons");
const CONTAINERS = new Set(["text", "strong", "em", "del", "link", "paragraph"]);

/**
 * `getLookup()` returns `(name) => glyph | undefined`, or undefined to draw
 * shortcodes as written. Returns a function that restores pi's renderer.
 */
export function installIconRenderer({ tui, getLookup }) {
  const proto = tui.Markdown.prototype;
  if (typeof proto.renderInlineTokens !== "function") throw new Error("pi's Markdown component changed (missing renderInlineTokens); icons stay as text");
  if (proto.renderInlineTokens[PATCHED]) {
    proto.renderInlineTokens[PATCHED].getLookup = getLookup;
    return proto.renderInlineTokens[PATCHED].restore;
  }
  const original = proto.renderInlineTokens;
  const state = { getLookup, restore: () => { proto.renderInlineTokens = original; } };
  function renderInlineTokens(tokens, styleContext) {
    const lookup = state.getLookup();
    return original.call(this, lookup && Array.isArray(tokens) ? withIcons(tokens, lookup) : tokens, styleContext);
  }
  renderInlineTokens[PATCHED] = state;
  proto.renderInlineTokens = renderInlineTokens;
  return state.restore;
}

/** Copies of the tokens with shortcodes swapped; unchanged tokens are reused, never mutated. */
export function withIcons(tokens, lookup) {
  let changed = false;
  const out = tokens.map((token) => {
    const next = tokenWithIcons(token, lookup);
    if (next !== token) changed = true;
    return next;
  });
  return changed ? out : tokens;
}

function tokenWithIcons(token, lookup) {
  if (!token || !CONTAINERS.has(token.type)) return token;
  if (token.tokens?.length) {
    const tokens = withIcons(token.tokens, lookup);
    return tokens === token.tokens ? token : { ...token, tokens };
  }
  if (token.type !== "text" || typeof token.text !== "string") return token;
  const text = iconize(token.text, lookup);
  return text === token.text ? token : { ...token, text };
}
