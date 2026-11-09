// Borderless tables: a bold header, a thin rule under each column, columns
// separated by whitespace. Cells wrap inside their column; when rows wrap, a
// blank line separates them. Too narrow for columns: one card per row.

import { align, spacing } from "./style.mjs";

const GAP = 3;
const MIN_COLUMN = 4;
const MAX_WORD = 24;
const NUMERIC = /^[-+−]?[$€£]?\d[\d.,_ ]*(?:%|[kKmMgGtT]i?[bB]?|ms|s|x)?$/;

/**
 * Column widths that fit `available`. Each column first gets its longest word
 * (so words are not split), then the remaining space goes to the columns that
 * still want more, shared equally (water filling).
 */
export function fitColumns(natural, available, minimum = natural.map(() => 1)) {
  const base = natural.map((n, i) => Math.min(n, Math.max(1, minimum[i])));
  const spare = available - base.reduce((a, b) => a + b, 0);
  if (spare < 0) return waterFill(natural, available);
  const extra = waterFill(natural.map((n, i) => n - base[i]), spare);
  return base.map((b, i) => b + extra[i]);
}

function waterFill(natural, available) {
  const widths = new Array(natural.length).fill(0);
  let pending = natural.map((_, i) => i);
  let space = available;
  while (pending.length) {
    const share = Math.floor(space / pending.length);
    const fits = pending.filter((i) => natural[i] <= share);
    if (!fits.length) {
      let extra = space - share * pending.length;
      for (const i of pending) widths[i] = share + (extra-- > 0 ? 1 : 0);
      break;
    }
    for (const i of fits) { widths[i] = natural[i]; space -= natural[i]; }
    pending = pending.filter((i) => !fits.includes(i));
  }
  return widths;
}

export function renderTable(md, ctx, token, width, nextTokenType, styleContext) {
  const { theme, visibleWidth } = ctx;
  const columns = token.header.length;
  if (!columns) return [];
  const inline = (cell) => md.renderInlineTokens(cell.tokens || [], styleContext);
  const header = token.header.map(inline);
  const rows = token.rows.map((row) => token.header.map((_, i) => (row[i] ? inline(row[i]) : "")));

  const available = width - GAP * (columns - 1);
  if (available < columns * MIN_COLUMN) return cards(ctx, header, rows, width, nextTokenType);

  // Right-align columns of plain numbers unless the author chose an alignment.
  const alignments = token.header.map((_, i) => token.align[i]
    ?? (rows.length && rows.every((r) => NUMERIC.test(ctx.strip(r[i]).trim() || "0")) ? "right" : null));

  const natural = header.map((h, i) => Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i]))));
  const longestWord = (text) => Math.max(0, ...ctx.strip(text).split(/\s+/).map(visibleWidth));
  const words = header.map((h, i) => Math.min(MAX_WORD, Math.max(longestWord(h), ...rows.map((r) => longestWord(r[i])))));
  const widths = fitColumns(natural.map((w) => Math.max(w, 1)), available, words).map((w) => Math.max(1, w));
  const wrap = (text, i) => md.wrapCellText(text, widths[i], styleContext?.stylePrefix);
  const line = (cells, style = (s) => s) =>
    cells.map((c, i) => style(align(c, widths[i], visibleWidth, alignments[i]))).join(" ".repeat(GAP)).trimEnd();

  const block = (cells, style) => {
    const wrapped = cells.map(wrap);
    const height = Math.max(...wrapped.map((c) => c.length));
    return Array.from({ length: height }, (_, k) => line(wrapped.map((c) => c[k] ?? ""), style));
  };

  const lines = block(header, (s) => theme.bold(s));
  lines.push(widths.map((w) => theme.fg("borderMuted", "─".repeat(w))).join(" ".repeat(GAP)));
  const bodies = rows.map((r) => block(r));
  const wraps = bodies.some((b) => b.length > 1);
  bodies.forEach((body, i) => {
    if (wraps && i > 0) lines.push("");
    lines.push(...body);
  });
  return [...lines, ...spacing(nextTokenType)];
}

/** Narrow terminals: each row becomes a small card of "Header  value" lines. */
function cards(ctx, header, rows, width, nextTokenType) {
  const { theme, visibleWidth, wrap } = ctx;
  const label = Math.min(Math.max(...header.map(visibleWidth)), Math.floor(width / 2));
  const lines = [];
  rows.forEach((row, r) => {
    if (r > 0) lines.push(theme.fg("borderMuted", "─".repeat(Math.min(width, 12))));
    header.forEach((h, i) => {
      const valueLines = wrap(row[i] || theme.fg("dim", "—"), Math.max(1, width - label - 2));
      const name = theme.fg("muted", align(ctx.truncate(h, label), label, visibleWidth));
      valueLines.forEach((v, k) => lines.push(`${k === 0 ? name : " ".repeat(label)}  ${v}`));
    });
  });
  return [...lines, ...spacing(nextTokenType)];
}
