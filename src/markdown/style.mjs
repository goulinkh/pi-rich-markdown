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
const LINK_END = "\x1b]8;;\x1b\\";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Break styled text into chunks of exactly `width` columns, keeping every
 * character (spaces included) and carrying the active styles into each chunk.
 * For code, where word wrapping would drop or move spaces.
 */
export function hardWrap(text, width, visibleWidth) {
  const chunks = [];
  // A hyperlink is closed at the end of each chunk and re-opened at the start
  // of the next, so every row of a wrapped URL opens the whole URL and the
  // link never runs into what follows the chunk (padding, the next row).
  let current = "", used = 0, active = [], link = "";
  for (const [i, part] of text.split(CODES).entries()) {
    if (i % 2) {
      current += part;
      if (part.startsWith("\x1b]8;")) link = /^\x1b\]8;[^;]*;[^\x07\x1b]+/.test(part) ? part : "";
      else active = part === "\x1b[0m" || part === "\x1b[m" ? [] : [...active, part];
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const w = visibleWidth(segment);
      if (used + w > width && used > 0) {
        chunks.push(link ? current + LINK_END : current);
        current = active.join("") + link;
        used = 0;
      }
      current += segment;
      used += w;
    }
  }
  chunks.push(current);
  return chunks;
}
