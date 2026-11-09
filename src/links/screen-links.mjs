// Last pass over pi's fullscreen screen: link the URLs no component linked.
//
// Text and Markdown are linkified before they wrap (linkify.mjs). Components
// that wrap plain text themselves (an extension's dialog, such as /btw's echo
// of your question or its tool results) still print plain URLs, which pi
// cannot open and which a wrap cuts into pieces.
//
// On the finished screen, a URL that was hard-wrapped is recognizable: a
// wrap breaks a URL only when it is longer than the line, so the URL starts a
// fresh line and every piece but the last fills its line from the first
// text column to the right edge (a box border or the screen edge). The
// following row continues at the same left edge. Pieces that fit that shape
// are joined into one URL and each is linked to it; any other unlinked URL is
// linked as it stands.

import { LINK_CLOSE, isTruncated, linkOpen, trimUrl } from "./linkify.mjs";

const PATCHED = Symbol.for("pi-rich-markdown.screen-links");
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\|\x1b[@-Z\\-_]/y;
const OSC8 = /^\x1b\]8;[^;]*;([^\x07\x1b]*)/;
const BORDER = /[│┃║▏▕╎╏┆┇┊┋]/;
const URL_START = /\b(?:https?|file):\/\/[^\s<>"'`\\│┃║▏▕]+/g;
const URL_CHARS = /^[^\s<>"'`\\│┃║▏▕]+/;

/** Patch pi's fullscreen frame compositing to link plain URLs. Returns a function that restores it. */
export function installScreenLinks({ tui, isEnabled = () => true }) {
  const base = tui.TuiAltScreen && Object.getPrototypeOf(tui.TuiAltScreen.prototype);
  const proto = typeof base?.compositeOverlays === "function" ? base : tui.TuiAltScreen?.prototype;
  if (typeof proto?.compositeOverlays !== "function") throw new Error("pi's screen compositing changed; plain URLs stay unlinked");
  if (proto.compositeOverlays[PATCHED]) {
    proto.compositeOverlays[PATCHED].isEnabled = isEnabled;
    return proto.compositeOverlays[PATCHED].restore;
  }
  const original = proto.compositeOverlays;
  const state = { isEnabled, restore: () => { proto.compositeOverlays = original; } };
  function compositeOverlays(lines, termWidth, termHeight) {
    const result = original.call(this, lines, termWidth, termHeight);
    // Fullscreen only: the regular screen passes its whole history here.
    if (!(this instanceof tui.TuiAltScreen) || !state.isEnabled()) return result;
    return linkScreen(result, termWidth);
  }
  compositeOverlays[PATCHED] = state;
  proto.compositeOverlays = compositeOverlays;
  return state.restore;
}

/** One screen row: visible text, where each column sits in the raw line, and which columns are linked. */
function scan(line) {
  let plain = "";
  const rawAt = [];
  const linked = [];
  let inLink = false;
  for (let i = 0; i < line.length; ) {
    if (line[i] === "\x1b") {
      ANSI.lastIndex = i;
      const m = ANSI.exec(line);
      if (m) {
        const osc8 = OSC8.exec(m[0]);
        if (osc8) inLink = osc8[1] !== "";
        i += m[0].length;
        continue;
      }
    }
    // URLs are ASCII: one column per code unit is enough to find and link them.
    rawAt.push(i);
    linked.push(inLink);
    plain += line[i];
    i++;
  }
  rawAt.push(line.length);
  return { plain, rawAt, linked };
}

/** Left edge of the text region holding column `col`: just after a border, or 0. */
function leftEdge(plain, col) {
  for (let c = col - 1; c >= 0; c--) {
    if (BORDER.test(plain[c])) return c + 1;
    if (plain[c] !== " ") return -1; // text before it on the row: not a fresh line
  }
  return 0;
}

/** Whether a run ending at `end` fills its line: a border right after it, or the screen edge. */
function fillsLine(plain, end, width) {
  if (BORDER.test(plain[end] ?? "")) return true;
  return end >= width - 2 && plain.slice(end).trim() === "";
}

/** `lines` with plain URLs linked, or `lines` itself when there are none. */
export function linkScreen(lines, width) {
  if (!lines.some((l) => l?.includes("://"))) return lines;
  const rows = new Map();
  const row = (r) => {
    if (!rows.has(r)) rows.set(r, lines[r] === undefined || lines[r].includes("\x1b_G") ? undefined : scan(lines[r]));
    return rows.get(r);
  };
  const edits = new Map(); // row -> [[startCol, endCol, url]]
  const add = (r, from, to, url) => {
    if (!edits.has(r)) edits.set(r, []);
    edits.get(r).push([from, to, url]);
  };

  for (let r = 0; r < lines.length; r++) {
    if (!lines[r]?.includes("://")) continue;
    const head = row(r);
    if (!head) continue;
    for (const m of head.plain.matchAll(URL_START)) {
      if (head.linked.slice(m.index, m.index + m[0].length).some(Boolean)) continue;
      const pieces = [[r, m.index, m.index + m[0].length]];
      const left = leftEdge(head.plain, m.index);
      // Follow a hard-wrapped URL onto the rows below.
      let [, , end] = pieces[0];
      let current = head;
      while (left >= 0 && fillsLine(current.plain, end, width)) {
        const next = row(pieces.at(-1)[0] + 1);
        if (!next) break;
        if (left > 0 && !BORDER.test(next.plain[left - 1] ?? "")) break;
        const start = left + (next.plain.slice(left).length - next.plain.slice(left).trimStart().length);
        const run = URL_CHARS.exec(next.plain.slice(start))?.[0];
        if (!run || next.linked[start]) break;
        pieces.push([pieces.at(-1)[0] + 1, start, start + run.length]);
        current = next;
        end = start + run.length;
        if (run.length < next.plain.length - start && next.plain[start + run.length] !== " " && !BORDER.test(next.plain[start + run.length])) break;
      }
      const text = pieces.map(([pr, from, to]) => row(pr).plain.slice(from, to)).join("");
      const url = trimUrl(text);
      if (isTruncated(text)) continue;
      if (!/^[a-z]+:\/\/[^/]/i.test(url) && !url.startsWith("file:///")) continue;
      // Drop what trimUrl cut from the end (sentence punctuation) from the last pieces.
      let cut = text.length - url.length;
      for (let i = pieces.length - 1; i >= 0 && cut > 0; i--) {
        const len = pieces[i][2] - pieces[i][1];
        const take = Math.min(len, cut);
        pieces[i][2] -= take;
        cut -= take;
      }
      for (const [pr, from, to] of pieces) if (to > from) add(pr, from, to, url);
    }
  }
  if (!edits.size) return lines;
  const out = [...lines];
  for (const [r, spans] of edits) {
    const { rawAt } = row(r);
    let line = lines[r];
    // Insert from the right so earlier raw positions stay valid.
    for (const [from, to, url] of spans.sort((a, b) => b[1] - a[1])) {
      const open = rawAt[from], close = rawAt[to - 1] + 1;
      line = line.slice(0, open) + linkOpen(url) + line.slice(open, close) + LINK_CLOSE + line.slice(close);
    }
    out[r] = line;
  }
  return out;
}
