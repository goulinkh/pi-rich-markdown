// Make every URL pi prints a terminal hyperlink (OSC 8), wrapped or not.
//
// pi turns Markdown links into OSC 8 hyperlinks, and its line wrapping
// re-opens a hyperlink on every line it continues on, so a wrapped Markdown
// link stays one clickable link. URLs anywhere else are plain text: tool and
// bash output, the `$ command` line, inline code, code blocks. In fullscreen
// mode pi handles clicks itself and opens only OSC 8 links, and terminals
// that detect URLs in text look at one row at a time, so a plain URL that
// wraps onto a second row opens a truncated address, or nothing.
//
// Wrapping plain URLs in OSC 8 before the text is wrapped makes each row of
// a long URL carry the whole address.

const URL = /\b(?:https?|file):\/\/[^\s<>"'`\\\x00-\x1f\x7f│┃║▏▕]+/g;
// Escape sequences: CSI, OSC (BEL or ST), APC (Kitty graphics), two-byte ESC.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\|\x1b[@-Z\\-_]/y;
const OSC8 = /^\x1b\]8;[^;]*;([^\x07\x1b]*)/;

export const linkOpen = (url) => `\x1b]8;;${url}\x1b\\`;
export const LINK_CLOSE = "\x1b]8;;\x1b\\";

/** Whether a URL was shortened for display ("…/very-lo..."): opening it would fail. */
export const isTruncated = (text) => /(?:\.\.\.|…)$/.test(text);

/** The URL without trailing punctuation that usually ends the sentence around it. */
export function trimUrl(url) {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    if (/[.,;:!?*_~]/.test(c)) end--;
    else if (c === ")" && count(url, "(", end) < count(url, ")", end)) end--;
    else if (c === "]" && count(url, "[", end) < count(url, "]", end)) end--;
    else if (c === "}" && count(url, "{", end) < count(url, "}", end)) end--;
    else break;
  }
  return url.slice(0, end);
}
const count = (s, ch, end) => s.slice(0, end).split(ch).length - 1;

/**
 * `text` (styled with ANSI codes) with every plain URL wrapped in an OSC 8
 * hyperlink. Text already inside a hyperlink, and lines carrying images, are
 * left alone. Returns `text` itself when nothing changes.
 */
export function linkify(text) {
  if (typeof text !== "string" || !text.includes("://") || text.includes("\x1b_G")) return text;
  // Visible text, where each visible character sits in the raw string, and
  // whether it is already inside a hyperlink.
  let plain = "";
  const rawAt = [];
  const linked = [];
  let inLink = false;
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      ANSI.lastIndex = i;
      const m = ANSI.exec(text);
      if (m) {
        const osc8 = OSC8.exec(m[0]);
        if (osc8) inLink = osc8[1] !== "";
        i += m[0].length;
        continue;
      }
    }
    rawAt.push(i);
    linked.push(inLink);
    plain += text[i];
    i++;
  }
  rawAt.push(text.length);

  const inserts = [];
  for (const m of plain.matchAll(URL)) {
    if (isTruncated(m[0])) continue;
    const url = trimUrl(m[0]);
    if (!/^[a-z]+:\/\/[^/]/i.test(url) && !url.startsWith("file:///")) continue;
    const start = m.index, end = m.index + url.length;
    if (linked.slice(start, end).some(Boolean)) continue;
    inserts.push([rawAt[start], linkOpen(url)], [rawAt[end - 1] + 1, LINK_CLOSE]);
  }
  if (!inserts.length) return text;
  let out = "";
  let from = 0;
  for (const [at, seq] of inserts) {
    out += text.slice(from, at) + seq;
    from = at;
  }
  return out + text.slice(from);
}

/**
 * Patch pi-tui's Text component, which draws tool output, bash output and
 * most status text, to linkify its text before wrapping. Returns a function
 * that restores it.
 */
const PATCHED = Symbol.for("pi-rich-markdown.links");
export function installTextLinks({ tui, isEnabled = () => true }) {
  const proto = tui.Text?.prototype;
  if (typeof proto?.render !== "function") throw new Error("pi's Text component changed; plain URLs stay unlinked");
  if (proto.render[PATCHED]) {
    proto.render[PATCHED].isEnabled = isEnabled;
    return proto.render[PATCHED].restore;
  }
  const original = proto.render;
  const state = { isEnabled, restore: () => { proto.render = original; } };
  const cache = new Map();
  function render(width) {
    const text = this.text;
    if (!state.isEnabled() || typeof text !== "string" || !text.includes("://")) return original.call(this, width);
    if (this.cachedLines && this.cachedText === text && this.cachedWidth === width) return this.cachedLines;
    let linked = cache.get(text);
    if (linked === undefined) {
      linked = linkify(text);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      cache.set(text, linked);
    }
    if (linked === text) return original.call(this, width);
    // Text caches its lines by its text: render the linked text, then key the
    // cache by the original so the next frame reuses the lines.
    this.text = linked;
    try {
      return original.call(this, width);
    } finally {
      this.text = text;
      if (this.cachedText === linked) this.cachedText = text;
    }
  }
  render[PATCHED] = state;
  proto.render = render;
  return state.restore;
}

/**
 * Patch Markdown inline rendering to linkify URLs in code spans
 * (`https://…`), which marked never turns into links. Code spans inside a
 * link keep that link. Returns a function that restores pi's renderer.
 */
const CODE_PATCHED = Symbol.for("pi-rich-markdown.code-links");
const CONTAINERS = new Set(["text", "strong", "em", "del", "paragraph"]);
export function installCodeSpanLinks({ tui, isEnabled = () => true }) {
  const proto = tui.Markdown?.prototype;
  if (typeof proto?.renderInlineTokens !== "function") throw new Error("pi's Markdown component changed; URLs in code stay unlinked");
  if (proto.renderInlineTokens[CODE_PATCHED]) {
    proto.renderInlineTokens[CODE_PATCHED].isEnabled = isEnabled;
    return proto.renderInlineTokens[CODE_PATCHED].restore;
  }
  const original = proto.renderInlineTokens;
  const state = { isEnabled, restore: () => { proto.renderInlineTokens = original; } };
  function renderInlineTokens(tokens, styleContext) {
    return original.call(this, state.isEnabled() && Array.isArray(tokens) ? withLinkedCode(tokens) : tokens, styleContext);
  }
  renderInlineTokens[CODE_PATCHED] = state;
  proto.renderInlineTokens = renderInlineTokens;
  return state.restore;
}

/** Copies of the tokens with URLs in code spans linkified; unchanged tokens are reused. */
export function withLinkedCode(tokens) {
  let changed = false;
  const out = tokens.map((token) => {
    let next = token;
    if (token?.type === "codespan" && typeof token.text === "string" && !token[IN_LINK]) {
      const text = linkify(token.text);
      if (text !== token.text) next = { ...token, text };
    } else if (token?.type === "link" && token.tokens?.length) {
      // pi renders a link's text with a separate renderInlineTokens call:
      // mark what is inside so that call leaves it to the link.
      next = { ...token, tokens: token.tokens.map(inLink) };
    } else if (CONTAINERS.has(token?.type) && token.tokens?.length) {
      const inner = withLinkedCode(token.tokens);
      if (inner !== token.tokens) next = { ...token, tokens: inner };
    }
    if (next !== token) changed = true;
    return next;
  });
  return changed ? out : tokens;
}

const IN_LINK = Symbol("pi-rich-markdown.in-link");
function inLink(token) {
  if (!token || typeof token !== "object" || token[IN_LINK]) return token;
  return { ...token, [IN_LINK]: true, ...(token.tokens ? { tokens: token.tokens.map(inLink) } : {}) };
}
