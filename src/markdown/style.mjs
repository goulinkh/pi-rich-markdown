// Small helpers shared by the block renderers.

/** "#rrggbb" for a pi theme Color, or undefined for terminal-default colors. */
export function colorHex(color) {
  if (!color || color.kind !== "rgb") return undefined;
  return `#${[color.r, color.g, color.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Keep a background across the ANSI resets inside already-styled text
 * (syntax highlighting ends spans with \x1b[0m or \x1b[49m).
 */
export function keepBackground(text, bgAnsi) {
  return bgAnsi ? text.replace(/\x1b\[(?:0|49)?m/g, (reset) => reset + bgAnsi) : text;
}

/** Pad styled text to `width` visible columns, honoring alignment. */
export function align(text, width, visibleWidth, alignment) {
  const gap = Math.max(0, width - visibleWidth(text));
  if (alignment === "right") return " ".repeat(gap) + text;
  if (alignment === "center") return " ".repeat(gap >> 1) + text + " ".repeat(gap - (gap >> 1));
  return text + " ".repeat(gap);
}

/** pi's spacing rule: a blank line after a block unless a space token follows. */
export function spacing(nextTokenType) {
  return nextTokenType && nextTokenType !== "space" ? [""] : [];
}

const CODES = /(\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\))/;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Break styled text into chunks of exactly `width` columns, keeping every
 * character (spaces included) and carrying the active styles into each chunk.
 * For code, where word wrapping would drop or move spaces.
 */
export function hardWrap(text, width, visibleWidth) {
  const chunks = [];
  let current = "", used = 0, active = [];
  for (const [i, part] of text.split(CODES).entries()) {
    if (i % 2) {
      current += part;
      active = part === "\x1b[0m" || part === "\x1b[m" ? [] : [...active, part];
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const w = visibleWidth(segment);
      if (used + w > width && used > 0) {
        chunks.push(current);
        current = active.join("");
        used = 0;
      }
      current += segment;
      used += w;
    }
  }
  chunks.push(current);
  return chunks;
}
