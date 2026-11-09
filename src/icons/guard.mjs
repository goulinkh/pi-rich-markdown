// Keep :nf-…: icon shortcodes out of everything but the chat.
//
// The shortcodes only mean something to this extension's terminal display.
// In a README, source file, commit message or PR body they are noise, so a
// tool call that would add them is blocked with a reason the model can act
// on. Intentional literal text (documenting or testing the syntax) passes:
// written as `:nf-x:`, ':nf-x:' or ":nf-x:", inside Markdown code, or by
// repeating the identical call once it was blocked.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { SHORTCODE } from "./nerd-fonts.mjs";

/** Tools whose input only queries; a shortcode there is a search, not output. */
const READ_ONLY = new Set(["read", "grep", "find", "ls"]);
const MARKDOWN = new Set([".md", ".mdx", ".markdown"]);
const QUOTES = new Set(["`", "'", "\""]);

/** Shortcode names in `text` that would read as icons, not as a quoted mention. */
export function iconShortcodes(text, { markdown = false } = {}) {
  if (typeof text !== "string" || !text.includes(":nf-")) return [];
  const code = markdown ? markdownCodeRanges(text) : [];
  const found = [];
  for (const m of text.matchAll(SHORTCODE)) {
    const start = m.index, end = start + m[0].length;
    const before = text[start - 1], after = text[end];
    if (before !== undefined && before === after && QUOTES.has(before)) continue;
    if (code.some(([s, e]) => start >= s && end <= e)) continue;
    found.push(m[1]);
  }
  return found;
}

/** [start, end) ranges of fenced code blocks and code spans in Markdown. */
export function markdownCodeRanges(text) {
  const ranges = [];
  let fence, fenceStart = 0, offset = 0;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence && marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
      ranges.push([fenceStart, offset + line.length]);
      fence = undefined;
    } else if (!fence && marker) {
      fence = marker;
      fenceStart = offset;
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push([fenceStart, text.length]);
  const inFence = (i) => ranges.some(([s, e]) => i >= s && i < e);
  const spans = [];
  const runs = [...text.matchAll(/`+/g)].filter((m) => !inFence(m.index));
  for (let i = 0; i < runs.length; i++) {
    const j = runs.findIndex((r, k) => k > i && r[0].length === runs[i][0].length);
    if (j < 0) continue;
    spans.push([runs[i].index, runs[j].index + runs[j][0].length]);
    i = j;
  }
  return [...ranges, ...spans];
}

/** Names in `after` beyond those already in `before` (an edit may keep existing ones). */
function added(after, before) {
  const left = new Map();
  for (const name of before) left.set(name, (left.get(name) ?? 0) + 1);
  return after.filter((name) => {
    const n = left.get(name) ?? 0;
    if (n) left.set(name, n - 1);
    return !n;
  });
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

function editsOf(input) {
  let edits = input.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      return [];
    }
  }
  if (edits && !Array.isArray(edits)) edits = [edits];
  if (!edits && typeof input.oldText === "string") edits = [input];
  return (edits ?? []).filter((e) => e && typeof e === "object");
}

/** Shortcode names a tool call would add to its output (a file, a command, a message…). */
export function shortcodesAdded(toolName, input, { readFile = () => undefined } = {}) {
  if (!input || typeof input !== "object" || READ_ONLY.has(toolName)) return [];
  const markdown = typeof input.path === "string" && MARKDOWN.has(extname(input.path).toLowerCase());
  const scan = (text) => iconShortcodes(text, { markdown });
  if (toolName === "write" && typeof input.content === "string") {
    return added(scan(input.content), scan(readFile(input.path) ?? ""));
  }
  if (toolName === "edit") {
    return editsOf(input).flatMap((e) => added(scan(e.newText), scan(e.oldText)));
  }
  return strings(input).flatMap(scan);
}

export const BLOCK_REASON = (names) =>
  `Nerd Font icon shortcodes (${[...new Set(names)].slice(0, 5).map((n) => `:nf-${n}:`).join(", ")}) only render in this chat. `
  + "Keep them out of files, code, commit messages and other tool input: remove them and retry. "
  + "If you deliberately need the literal text (e.g. documenting or testing the syntax), repeat this exact call unchanged.";

/** A tool_call handler; returns a block result when a call would add shortcodes. */
export function createIconGuard({ readFile = readFileFrom } = {}) {
  const confirmed = new Set();
  return (event, ctx) => {
    const names = shortcodesAdded(event.toolName, event.input, { readFile: (path) => readFile(path, ctx?.cwd) });
    if (!names.length) return undefined;
    const key = `${event.toolName}\0${JSON.stringify(event.input)}`;
    if (confirmed.delete(key)) return undefined;
    if (confirmed.size > 50) confirmed.clear();
    confirmed.add(key);
    return { block: true, reason: BLOCK_REASON(names) };
  };
}

function readFileFrom(path, cwd = process.cwd()) {
  if (typeof path !== "string") return undefined;
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  const full = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  try {
    return existsSync(full) ? readFileSync(full, "utf8") : undefined;
  } catch {
    return undefined;
  }
}
