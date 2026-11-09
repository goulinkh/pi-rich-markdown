// Images inside pi's fullscreen layout: kept within the transcript's scroll view.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KittyImageStore, planImage } from "../src/graphics/kitty-images.mjs";
import { piImageRegistrar } from "../src/graphics/pi-registry.mjs";

const piRoot = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tuiDist = join(piRoot, "node_modules/@earendil-works/pi-tui/dist");
const tui = await import(pathToFileURL(join(tuiDist, "index.js")).href);
// Not exported; the same module instance pi-tui's index uses.
const { renderLayoutFrame } = await import(pathToFileURL(join(tuiDist, "layout.js")).href);

const cell = { widthPx: 17, heightPx: 37 };
const controls = (line: string) => Object.fromEntries(/\x1b_G([^;]*);/.exec(line)![1].split(",").map((kv) => kv.split("=")));

/** A component drawing one 10-row image, the way the Markdown renderer does. */
function imageComponent(store: KittyImageStore, owner: object) {
  const plan = planImage({ natural: { widthPx: 340, heightPx: 370 }, maxColumns: 20, cell });
  const sequence = store.image(owner, plan, (p) => ({ data: Buffer.alloc(p.widthPx * p.heightPx * 3, 0x80), format: 24, widthPx: p.widthPx, heightPx: p.heightPx }));
  return { plan, render: () => [sequence, ...Array(plan.rows - 1).fill("")], invalidate() {} };
}

/** Transcript (scroll view) with the image after `before` text rows, and an editor row below. */
function frame(component: { render: () => string[] }, { before = 0, height = 8 } = {}) {
  const transcript = new tui.Container();
  if (before) transcript.addChild(new tui.Text(Array.from({ length: before }, (_, i) => `line ${i}`).join("\n"), 0, 0));
  transcript.addChild(component);
  transcript.addChild(new tui.Text("after", 0, 0));
  const scroll = new tui.ScrollView(transcript, { follow: "none" });
  const editor = new tui.Text("❯ prompt", 0, 0);
  const root = new tui.VStack([{ component: scroll, grow: 1, shrink: 1, basis: 0 }, editor]);
  const draw = () => renderLayoutFrame(root, 40, height, () => {});
  draw();
  return { scroll, draw };
}

let saved: unknown;
before(() => {
  saved = tui.getCapabilities();
  tui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  tui.setCellDimensions(cell);
});
after(() => tui.setCapabilities(saved));

test("without registration pi places the image over the editor", () => {
  const store = new KittyImageStore({});
  const image = imageComponent(store, {});
  const { draw } = frame(image);
  const line = draw().lines.find((l: string) => l.includes("\x1b_G"));
  assert.equal(controls(line).r, "10", "full height, though only 7 rows are visible");
});

test("registered images are cropped at the bottom of the scroll view", () => {
  const store = new KittyImageStore({ onTransmit: piImageRegistrar(tui) });
  const image = imageComponent(store, {});
  const { draw } = frame(image);
  const { lines } = draw();
  const line = lines.find((l: string) => l.includes("\x1b_G"));
  const c = controls(line);
  assert.equal(c.r, "7", "7 visible rows above the editor");
  assert.equal(Number(c.h), Math.ceil((image.plan.heightPx * 7) / 10));
  assert.equal(lines.at(-1).trimEnd(), "❯ prompt");
});

test("registered images scrolled past the top show their lower part", () => {
  const store = new KittyImageStore({ onTransmit: piImageRegistrar(tui) });
  const image = imageComponent(store, {});
  const { scroll, draw } = frame(image);
  scroll.scrollTo(4);
  const { lines } = draw();
  const c = controls(lines[0]);
  assert.equal(c.y, String(Math.floor((image.plan.heightPx * 4) / 10)));
  assert.equal(c.r, "6");
});

test("registering leaves pi's cell size alone", () => {
  const register = piImageRegistrar(tui)!;
  register({ imageId: 424242, columns: 3, rows: 2, widthPx: 51, heightPx: 74 });
  assert.deepEqual(tui.getCellDimensions(), cell);
});
