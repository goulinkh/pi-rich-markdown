// Overlays drawn over images, with pi's real overlay compositing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clipImages, installOverlayImageClip } from "../src/graphics/overlays.mjs";

const piRoot = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(piRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);

const controls = (line: string) => Object.fromEntries(/\x1b_G([^;\x1b]*)/.exec(line)![1].split(",").map((kv) => kv.split("=")));
// A 10-row image of 370 px at row 2, transmitted as raw pixels the way the store sends it.
const IMAGE = " \x1b_Ga=T,f=24,o=z,s=340,v=370,i=77,c=20,r=10,C=1,q=2;AAAA\x1b\\";
const screenLines = () => ["top", "", IMAGE, ...Array(9).fill(""), "after", "", "", ""];

let restore: () => void;
before(() => {
  restore = installOverlayImageClip({ tui });
});
after(() => restore());

function screenWithOverlay(options: object) {
  const terminal = { columns: 40, rows: 16, write() {}, start() {}, stop() {}, on() {}, off() {}, hideCursor() {}, showCursor() {} };
  const screen = new tui.TuiAltScreen(terminal, false);
  screen.requestRender = () => {};
  screen.showOverlay(new tui.Text("DIALOG\nDIALOG\nDIALOG", 0, 0), options);
  return screen;
}

test("an overlay across the middle of an image splits it around the overlay", () => {
  const screen = screenWithOverlay({ row: 5, col: 4, width: 10 });
  const out = screen.compositeOverlays(screenLines(), 40, 16);
  const top = controls(out[2]);
  assert.equal(top.a, "T", "the upper part still carries the image data");
  assert.deepEqual([top.y, top.h, top.r], ["0", "111", "3"]);
  for (const row of [5, 6, 7]) assert.ok(out[row].includes("DIALOG"), `row ${row} shows the overlay`);
  const lower = controls(out[8]);
  assert.deepEqual([lower.a, lower.i, lower.p, lower.r, lower.y, lower.h], ["p", "77", "2", "4", "222", "148"]);
});

test("an overlay over the top of an image moves the image data below it", () => {
  const screen = screenWithOverlay({ row: 1, col: 0, width: 30 });
  const out = screen.compositeOverlays(screenLines(), 40, 16);
  assert.ok(out[2].includes("DIALOG"), "the row the image started on shows the overlay");
  assert.ok(!out[2].includes("\x1b_G"));
  const moved = controls(out[4]);
  assert.deepEqual([moved.a, moved.r, moved.y, moved.h], ["T", "8", "74", "296"]);
});

test("overlays beside an image leave it alone", () => {
  const screen = screenWithOverlay({ row: 5, col: 25, width: 10 });
  const lines = screenLines();
  const out = screen.compositeOverlays(lines, 40, 16);
  assert.equal(out[2], IMAGE);
});

test("images without a pixel height are hidden while covered", () => {
  const png = "\x1b_Ga=T,f=100,i=5,c=20,r=4,C=1,q=2;AAAA\x1b\\";
  const out = clipImages([png, "", "", ""], [{ top: 1, bottom: 2, left: 0, right: 10 }], tui.visibleWidth);
  assert.equal(out![0], "");
});

test("no overlay, no change", () => {
  assert.equal(clipImages(screenLines(), [], tui.visibleWidth), undefined);
});
