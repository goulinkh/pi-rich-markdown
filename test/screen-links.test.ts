// Plain URLs left on pi's fullscreen screen, wrapped ones included, become one link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { linkScreen } from "../src/links/screen-links.mjs";

const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const at = (line: string, text: string) => tui.getOsc8LinkAtColumn(line, tui.stripTerminalSequences(line).indexOf(text));

const URL = "https://github.com/earendil-works/pi-coding-agent/blob/main/packages/coding-agent/docs/btw-dialog-link.md#anchor";

test("a URL wrapped inside a dialog box opens whole from each row", () => {
  // As /btw echoes a question: wrapped to the box's inner width, framed by │.
  const inner = 30;
  const text = `You asked about ${URL} and more`;
  const wrapped = tui.wrapTextWithAnsi(text, inner);
  const screen = wrapped.map((l: string) => `ab │${l}${" ".repeat(inner - tui.visibleWidth(l))}│ cd`);
  const out = linkScreen(screen, 40);
  const urlRows = out.filter((l: string) => /github|earendil|packages|docs|anchor/.test(tui.stripTerminalSequences(l)));
  assert.ok(urlRows.length >= 3);
  for (const line of urlRows) {
    const plain = tui.stripTerminalSequences(line);
    const piece = plain.slice(4, 4 + inner).trim().split(" ")[0];
    assert.equal(at(line, piece), URL, plain);
  }
  const last = out.find((l: string) => l.includes("more"))!;
  assert.equal(at(last, "more"), undefined, "the words after the URL are not linked");
  assert.equal(at(out[0], "ab"), undefined, "text outside the box is not linked");
});

test("a short URL in prose is linked, sentence punctuation excluded", () => {
  const out = linkScreen(["  see https://example.com/a. Then go on", "  next row"], 40);
  assert.equal(at(out[0], "https"), "https://example.com/a");
  assert.equal(tui.getOsc8LinkAtColumn(out[0], tui.stripTerminalSequences(out[0]).indexOf(". Then")), undefined);
  assert.equal(out[1], "  next row");
});

test("already linked URLs, image rows and URL-free screens are untouched", () => {
  const linked = `\x1b]8;;${URL}\x1b\\${URL.slice(0, 30)}\x1b]8;;\x1b\\`;
  const image = "\x1b_Ga=p,i=1\x1b\\ https://example.com/x";
  const screen = [linked, image, "plain"];
  assert.deepEqual(linkScreen(screen, 30), screen);
  const none = ["a", "b"];
  assert.equal(linkScreen(none, 30), none);
});

test("a URL that fits is not joined with the next line", () => {
  const out = linkScreen(["https://example.com/abcdef    ", "continued words"], 30);
  assert.equal(at(out[0], "https"), "https://example.com/abcdef");
  assert.equal(out[1], "continued words");
});
