import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cellDimensionsSource } from "../src/graphics/cells.mjs";

const piTui = { getCellDimensions: () => ({ widthPx: 8, heightPx: 16 }) };
const rexEnv = { TERM_PROGRAM: "rex", REX_SESSION: "session:1", REX_BLOCK: "block:2" };

test("inside Rex, cell size comes from the Rex CLI, not the CSI 16t answer", () => {
  const calls: string[][] = [];
  const run = (_bin: string, args: string[]) => { calls.push(args); return JSON.stringify({ cell_width_px: 17, cell_height_px: 37 }); };
  const cells = cellDimensionsSource(piTui, { env: rexEnv, stdout: null, run });
  assert.deepEqual(cells(), { widthPx: 17, heightPx: 37 });
  assert.deepEqual(calls[0], ["block", "call", "-s", "session:1", "-b", "block:2", "size"]);
});

test("a resize asks Rex again", () => {
  let width = 17;
  const stdout = new EventEmitter();
  const run = () => JSON.stringify({ cell_width_px: width, cell_height_px: 37 });
  const cells = cellDimensionsSource(piTui, { env: rexEnv, stdout, run });
  width = 20;
  stdout.emit("resize");
  assert.equal(cells().widthPx, 20);
});

test("outside Rex, or when the CLI fails, pi's value is used", () => {
  assert.deepEqual(cellDimensionsSource(piTui, { env: {}, stdout: null })(), { widthPx: 8, heightPx: 16 });
  const failing = () => { throw new Error("no rex"); };
  assert.deepEqual(cellDimensionsSource(piTui, { env: rexEnv, stdout: null, run: failing })(), { widthPx: 8, heightPx: 16 });
});
