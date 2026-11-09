// Runs pi's real Image component (from the installed pi) with the budget installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { KittyImageStore, decodedBytes, limitsFromEnv } from "../src/graphics/kitty-images.mjs";
import { installImageBudget } from "../src/graphics/pi-images.mjs";

const MiB = 1024 * 1024;
const piRoot = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(piRoot, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);

const theme = { fallbackColor: (s: string) => s };
const screenshot = (w: number, h: number) =>
  new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#445566"/><circle cx="${w / 2}" cy="${h / 2}" r="${h / 3}" fill="#ddeeff"/></svg>`, { font: { loadSystemFonts: false } })
    .render().asPng().toString("base64");
const header = (line: string) => Object.fromEntries(/\x1b_G([^;]*);/.exec(line)![1].split(",").map((kv) => kv.split("=")));

let restore: () => void;
let store: KittyImageStore;

before(() => {
  tui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  tui.setCellDimensions({ widthPx: 17, heightPx: 37 }); // what Rex reports on a Retina Mac
  store = new KittyImageStore({ budgetBytes: 8 * MiB, maxImageBytes: 4 * MiB });
  restore = installImageBudget({ tui, store, limits: limitsFromEnv({}) });
});
after(() => restore());

test("pi's Image sends compact RGB sized to its cells, not the full PNG", () => {
  const data = screenshot(1524, 938);
  const lines = new tui.Image(data, "image/png", theme, { maxWidthCells: 60 }).render(120);
  const h = header(lines[0]);
  assert.equal(h.f, "24");
  assert.equal(h.o, "z");
  assert.equal(Number(h.s), 60 * 17);
  assert.equal(Number(h.c), 60);
  assert.equal(lines.length, Number(h.r), "reserves one line per image row");
  assert.ok(decodedBytes(Number(h.s), Number(h.v)) < (1524 * 938 * 4) / 2);
});

test("re-rendering reuses the image; two components never share an ID", () => {
  const data = screenshot(800, 400);
  const a = new tui.Image(data, "image/png", theme, { maxWidthCells: 40 });
  const first = a.render(100);
  a.invalidate();
  assert.equal(a.render(100)[0], first[0]);
  const b = new tui.Image(data, "image/png", theme, { maxWidthCells: 40 });
  assert.notEqual(header(b.render(100)[0]).i, header(first[0]).i);
});

test("many screenshots stay under the budget", () => {
  for (let i = 0; i < 25; i++) new tui.Image(screenshot(1500 + i, 950), "image/png", theme, { maxWidthCells: 60 }).render(120);
  assert.ok(store.stats.totalBytes <= 8 * MiB, `${store.stats.totalBytes / MiB} MiB`);
});

test("undecodable data falls back to text instead of sending anything", () => {
  const lines = new tui.Image("bm90IGFuIGltYWdl", "image/png", theme, { maxWidthCells: 60 }).render(80);
  assert.doesNotMatch(lines[0], /\x1b_G/);
});

test("other terminals keep pi's original rendering", () => {
  tui.setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
  try {
    const lines = new tui.Image(screenshot(200, 100), "image/png", theme, { maxWidthCells: 20 }).render(80);
    assert.match(lines.at(-1)!, /\x1b\]1337;File=/);
  } finally {
    tui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  }
});
