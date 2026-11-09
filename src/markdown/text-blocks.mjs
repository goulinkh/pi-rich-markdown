// Headings, block quotes, GitHub callouts and lists.

import { spacing } from "./style.mjs";

/** Headings without "#" markers: the level shows through rules and weight. */
export function renderHeading(md, ctx, token, width, nextTokenType) {
  const { theme, visibleWidth } = ctx;
  const level = token.depth;
  const style = level <= 3
    ? (text) => theme.fg("mdHeading", theme.bold(text))
    : (text) => theme.bold(text);
  const context = { applyText: style, stylePrefix: md.getStylePrefix(style) };
  const title = md.renderInlineTokens(token.tokens || [], context);
  const lines = ctx.wrap(title, width);
  const rule = Math.min(width, Math.max(...lines.map(visibleWidth)));
  if (level === 1) lines.push(theme.fg("mdHeading", "━".repeat(rule)));
  else if (level === 2) lines.push(theme.fg("borderMuted", "─".repeat(rule)));
  return [...lines, ...spacing(nextTokenType)];
}

const CALLOUTS = {
  NOTE: { title: "Note", color: "mdLink", icon: "ℹ" },
  TIP: { title: "Tip", color: "success", icon: "✓" },
  IMPORTANT: { title: "Important", color: "accent", icon: "✱" },
  WARNING: { title: "Warning", color: "warning", icon: "!" },
  CAUTION: { title: "Caution", color: "error", icon: "✕" },
};

/**
 * `> [!NOTE]` style callouts get a colored bar and title; plain quotes keep
 * pi's rendering with a lighter bar.
 */
export function renderQuote(md, ctx, token, width, nextTokenType, styleContext, original) {
  const { theme } = ctx;
  const kind = calloutKind(token);
  if (!kind || width < 4) {
    const plainBar = md.theme.quoteBorder("│ ");
    const bar = md.theme.quoteBorder("▎ ");
    return original().map((line) => (line.startsWith(plainBar) ? bar + line.slice(plainBar.length) : line));
  }
  const { title, color, icon } = CALLOUTS[kind];
  const body = withoutMarker(token);
  const bar = theme.fg(color, "▎ ");
  const lines = [bar + theme.fg(color, theme.bold(`${icon} ${title}`))];
  const children = body.tokens || [];
  const inner = [];
  children.forEach((child, i) => inner.push(...md.renderToken(child, width - 2, children[i + 1]?.type, { applyText: (t) => t, stylePrefix: "" })));
  while (inner.length && inner.at(-1) === "") inner.pop();
  for (const line of inner) for (const part of ctx.wrap(line, width - 2)) lines.push(bar + part);
  return [...lines, ...spacing(nextTokenType)];
}

function calloutKind(token) {
  const first = token.tokens?.[0];
  const text = first?.type === "paragraph" ? first.tokens?.[0] : undefined;
  const kind = text?.type === "text" ? /^\[!(\w+)\]/.exec(text.text)?.[1]?.toUpperCase() : undefined;
  return kind && CALLOUTS[kind] ? kind : undefined;
}

/** Copy of the quote with the `[!KIND]` marker line removed. */
function withoutMarker(token) {
  const [first, ...rest] = token.tokens;
  const [text, ...inline] = first.tokens;
  const remaining = text.text.replace(/^\[!\w+\][ \t]*\n?/, "");
  const tokens = remaining ? [{ ...text, raw: remaining, text: remaining }, ...inline] : inline;
  return { ...token, tokens: tokens.length ? [{ ...first, tokens }, ...rest] : rest };
}

/**
 * pi's lists with round bullets (• top level, ◦ nested) and check boxes for
 * task items. Task markers shrink from "- [x] " to "✔ ", so the wrapped
 * lines of a task item move left by the same amount.
 */
export function renderListBullets(md, ctx, lines) {
  const { theme } = ctx;
  const dash = md.theme.listBullet("- ");
  const tasks = [
    [md.theme.listBullet("- [x] "), theme.fg("success", "✔ ")],
    [md.theme.listBullet("- [ ] "), theme.fg("muted", "☐ ")],
  ];
  let continuation; // indent of the wrapped lines of the current task item
  return lines.map((line) => {
    const indent = /^ */.exec(line)[0].length;
    if (continuation !== undefined && indent === continuation && line.length > indent) return line.slice(4);
    continuation = undefined;
    for (const [marker, box] of tasks) {
      if (line.startsWith(marker, indent)) {
        continuation = indent + 6;
        return line.slice(0, indent) + box + line.slice(indent + marker.length);
      }
    }
    if (!line.startsWith(dash, indent)) return line;
    return line.slice(0, indent) + md.theme.listBullet(indent >= 4 ? "◦ " : "• ") + line.slice(indent + dash.length);
  });
}
