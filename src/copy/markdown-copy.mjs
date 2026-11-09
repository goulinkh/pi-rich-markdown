// Copy selections as Markdown in pi's fullscreen mode.
//
// Fullscreen pi owns mouse selection and copies what is on screen: rendered
// lines with the styling stripped. A selected table comes out as aligned
// columns, a code panel with its padding and wrap marks, a diagram as blank
// lines. Here, rows that belong to a Markdown component are replaced by the
// Markdown source of the blocks they show; other rows (tool output, status
// text) copy as before.
//
// The transcript is one scroll view whose content is the concatenated output
// of its components, so a Markdown component is found by matching its
// rendered lines, and Markdown.render keeps each block's lines (blocks, keyed
// by token.raw), which maps rows to source blocks.

const PATCHED = Symbol.for("pi-rich-markdown.copy");
// Prefixes containers add to a component's first or last line.
const OSC133 = /^(?:\x1b\]133;[A-D][^\x07\x1b]*(?:\x07|\x1b\\))+/;

/** Patch TuiAltScreen.getActiveSelectionText. Returns a function that restores pi's. */
export function installMarkdownCopy({ tui, isEnabled = () => true, onError = () => {}, transform = (text) => text }) {
  const proto = tui.TuiAltScreen?.prototype;
  if (typeof proto?.getActiveSelectionText !== "function" || typeof proto.getSelectionBounds !== "function") {
    throw new Error("pi's fullscreen selection changed; copying stays plain text");
  }
  if (proto.getActiveSelectionText[PATCHED]) {
    Object.assign(proto.getActiveSelectionText[PATCHED], { isEnabled, onError, transform });
    return proto.getActiveSelectionText[PATCHED].restore;
  }
  const original = proto.getActiveSelectionText;
  const state = { isEnabled, onError, transform, restore: () => { proto.getActiveSelectionText = original; } };
  function getActiveSelectionText() {
    const plain = original.call(this);
    if (plain === undefined || !state.isEnabled()) return plain;
    try {
      return selectionAsMarkdown(this, tui, state.transform) ?? plain;
    } catch (error) {
      state.onError(error);
      return plain;
    }
  }
  getActiveSelectionText[PATCHED] = state;
  proto.getActiveSelectionText = getActiveSelectionText;
  return state.restore;
}

/** The selection with Markdown rows replaced by their source, or undefined to keep pi's text. */
export function selectionAsMarkdown(screen, tui, transform = (text) => text) {
  const selection = screen.getSelectionBounds();
  const scrollView = selection?.start.scrollView;
  if (!scrollView) return undefined;
  const box = findScrollBox(screen.currentLayout, scrollView);
  const lines = box?.scrollContentLines;
  const root = box?.children?.[0]?.component;
  if (!lines || !root) return undefined;

  const first = selection.start.row, last = selection.end.row;
  const spans = locateMarkdown(root, lines, tui.Markdown).filter((s) => s.end > first && s.start <= last);
  if (!spans.length) return undefined;

  // The selected columns of a row, or undefined outside the selection.
  const columns = (row) => (row < first || row > last ? undefined : screen.getSelectionColumns(lines[row] ?? "", row, selection));
  // Text between two columns of a row, styling stripped.
  const slice = (row, start, end) =>
    tui.stripTerminalSequences(tui.sliceByColumn(lines[row] ?? "", start, Math.max(0, end - start), true));
  // pi's text for one row: the selected columns, styling stripped.
  const selected = (row) => {
    const cols = columns(row);
    return cols ? slice(row, cols.start, cols.end).trimEnd() : "";
  };
  const whole = (row) => tui.stripTerminalSequences(lines[row] ?? "").trimEnd();

  const parts = [];
  let plain = [];
  const flushPlain = () => {
    const text = plain.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) parts.push(text);
    plain = [];
  };
  let row = first;
  let changed = false;
  for (const span of spans) {
    for (; row < span.start; row++) plain.push(selected(row));
    const layout = blockRows(span.md);
    const stop = Math.min(last + 1, span.end);
    if (!layout) continue; // rows stay plain
    const from = row - span.start, to = stop - 1 - span.start;
    const hit = layout.filter((b) => b.end > from && b.start <= to && b.token.type !== "space");
    const source = sourceFor(hit, span, { selected, whole, columns, slice, tui, from, to });
    if (source === undefined) continue;
    flushPlain();
    if (source) parts.push(transform(source));
    row = stop;
    changed = true;
  }
  for (; row <= last; row++) plain.push(selected(row));
  flushPlain();
  return changed ? parts.join("\n\n") : undefined;
}

/**
 * Markdown for the blocks a selection touches inside one component, or
 * undefined when pi's text for those rows is already right (part of a
 * paragraph, a word picked with a double click).
 */
function sourceFor(hit, span, { selected, whole, columns, slice, tui, from, to }) {
  if (!hit.length) return "";
  if (hit.length > 1) return hit.map((b) => b.token.raw.replace(/\n+$/, "")).join("\n\n");
  const [block] = hit;
  const rows = [];
  for (let r = block.start; r < block.end; r++) rows.push(span.start + r);
  const covered = rows.every((r) => selected(r).trim() === whole(r).trim());
  const raw = block.token.raw.replace(/\n+$/, "");
  if (covered) return raw;
  if (block.token.type === "code" && !isGraphic(block)) {
    return codeLines(block, span.start, rows.filter((r) => r - span.start >= from && r - span.start <= to), whole) ?? raw;
  }
  if (block.token.type === "table") return tableCell(block, span, { whole, columns, slice, tui }) ?? raw;
  if (block.token.type === "code" || isGraphic(block)) return raw;
  return undefined;
}

/**
 * The text of the one table cell a selection touches (see markdown/table.mjs:
 * header rows, a rule of one "─" run per column, body rows, with a blank row
 * between rows when any cell wraps). Selected characters on a single row
 * copy as they are, like a double-clicked word; more copies the whole cell as
 * it reads on screen, unwrapped and without its Markdown, so a value pastes as
 * itself. undefined when the selection spans cells or the table was drawn
 * some other way (cards on narrow terminals).
 */
function tableCell(block, span, { whole, columns, slice, tui }) {
  const { token } = block;
  const base = span.start + block.start;
  const n = block.end - block.start;
  const at = (i) => whole(base + i);
  const rule = [...Array(n).keys()].find((i) => /^ *─+(?: +─+)* *$/.test(at(i)));
  if (!(rule >= 1)) return undefined;
  const cells = [...at(rule).matchAll(/─+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (cells.length !== token.header.length) return undefined;

  let end = n;
  while (end > rule + 1 && !at(end - 1).trim()) end--;
  const body = [];
  for (let i = rule + 1; i < end; i++) body.push(i);
  const groups = [{ cells: token.header, rows: [...Array(rule).keys()] }];
  if (body.some((i) => !at(i).trim())) {
    let rows = [];
    for (const i of [...body, -1]) {
      if (i >= 0 && at(i).trim()) { rows.push(i); continue; }
      if (rows.length) groups.push({ rows });
      rows = [];
    }
  } else {
    for (const i of body) groups.push({ rows: [i] });
  }
  if (groups.length !== token.rows.length + 1) return undefined;
  groups.forEach((g, k) => { if (k > 0) g.cells = token.rows[k - 1]; });

  // Cells holding selected characters, with what is selected of them per row.
  const touched = new Map();
  for (const group of groups) {
    for (const i of group.rows) {
      const cols = columns(base + i);
      if (!cols) continue;
      cells.forEach((cell, c) => {
        const lo = Math.max(cols.start, cell.start), hi = Math.min(cols.end, cell.end);
        const text = hi > lo ? slice(base + i, lo, hi).trim() : "";
        if (!text) return;
        const key = `${groups.indexOf(group)}:${c}`;
        if (!touched.has(key)) touched.set(key, { group, c, picked: [] });
        touched.get(key).picked.push({ i, text, all: text === slice(base + i, cell.start, cell.end).trim() });
      });
    }
  }
  if (touched.size !== 1) return undefined;
  const [{ group, c, picked }] = touched.values();
  if (picked.length === 1 && !picked[0].all) return picked[0].text;
  const cell = group.cells[c];
  if (!cell) return undefined;
  return tui.stripTerminalSequences(span.md.renderInlineTokens(cell.tokens || [])).trim();
}

const isGraphic = (block) => block.lines.some((l) => l.includes("\x1b_G") || l.includes("\x1b]1337;File="));

/**
 * Source lines behind the selected rows of a code panel (see markdown/code.mjs:
 * an edge row, the language row, one row per line plus "↪ " continuation rows,
 * an edge row, spacing). undefined when the block was drawn some other way.
 */
function codeLines(block, spanStart, selectedRows, whole) {
  const at = (i) => whole(spanStart + block.start + i).trim();
  const n = block.end - block.start;
  if (!/^▄+$/.test(at(0))) return undefined;
  const source = block.token.text.split("\n");
  let i = block.token.lang?.trim() ? 2 : 1;
  const picked = new Set();
  let line = -1;
  for (; i < n && !/^▀+$/.test(at(i)); i++) {
    if (!at(i).startsWith("↪ ")) line++;
    if (selectedRows.includes(spanStart + block.start + i) && line >= 0) picked.add(line);
  }
  if (line !== source.length - 1) return undefined;
  if (!picked.size) return "";
  const lines = [...picked].sort((a, b) => a - b);
  return source.slice(lines[0], lines.at(-1) + 1).join("\n");
}

function findScrollBox(box, scrollView) {
  if (!box) return undefined;
  if (box.root && !box.children) box = box.root; // a layout frame
  if (box.scrollView === scrollView) return box;
  for (const child of box.children ?? []) {
    const found = findScrollBox(child, scrollView);
    if (found) return found;
  }
  return undefined;
}

/** Markdown components under `root`, in order, with the content rows they occupy. */
export function locateMarkdown(root, lines, Markdown) {
  const spans = [];
  let cursor = 0;
  for (const md of markdownComponents(root, Markdown)) {
    const own = md.cachedLines;
    if (!own?.length) continue;
    const start = findRun(lines, own, cursor);
    if (start < 0) continue;
    spans.push({ md, start, end: start + own.length });
    cursor = start + own.length;
  }
  return spans;
}

function* markdownComponents(component, Markdown, seen = new Set()) {
  if (!component || typeof component !== "object" || seen.has(component)) return;
  seen.add(component);
  if (component instanceof Markdown) {
    yield component;
    return;
  }
  for (const child of component.children ?? []) yield* markdownComponents(child, Markdown, seen);
  if (component.child) yield* markdownComponents(component.child, Markdown, seen);
}

const same = (screenLine, own) => screenLine === own || screenLine.replace(OSC133, "") === own;

/** First index >= from where `own` appears line for line in `lines`, or -1. */
function findRun(lines, own, from) {
  const anchor = own.findIndex((l) => l.trim());
  if (anchor < 0) return -1;
  for (let row = from + anchor; row < lines.length; row++) {
    if (!same(lines[row], own[anchor])) continue;
    const start = row - anchor;
    if (own.every((l, i) => same(lines[start + i] ?? "", l))) return start;
  }
  return -1;
}

/** Each top-level token with the rows its block occupies in md.cachedLines. */
export function blockRows(md) {
  let tokens = md.cachedTokens?.deref()?.tokens;
  let blocks = md.blocks?.deref();
  if (!tokens || !blocks) {
    // Both are held weakly; render again (same lines) to rebuild them. They
    // stay alive until the current job ends.
    const width = md.cachedWidth;
    if (typeof width !== "number") return undefined;
    md.cachedText = undefined;
    md.render(width);
    tokens = md.cachedTokens?.deref()?.tokens;
    blocks = md.blocks?.deref();
    if (!tokens || !blocks) return undefined;
  }
  let row = md.paddingY ?? 0;
  const layout = [];
  for (const token of tokens) {
    const block = blocks.get(token.raw);
    if (!block) return undefined;
    layout.push({ token, lines: block.lines, start: row, end: row + block.lines.length });
    row += block.lines.length;
  }
  return layout;
}
