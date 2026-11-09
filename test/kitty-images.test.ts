import { test } from "node:test";
import { Resvg } from "@resvg/resvg-js";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import {
  KittyImageStore,
  decodedBytes,
  encodeKittyPixels,
  limitsFromEnv,
  planImage,
} from "../src/graphics/kitty-images.mjs";
import { flatten, pack, rasterizeBitmap, rasterizeSvg, svgNaturalSize } from "../src/graphics/rasterize.mjs";

const MiB = 1024 * 1024;
const cell = { widthPx: 9, heightPx: 18 };
const rgbOf = (plan: { widthPx: number; heightPx: number }) => ({
  data: Buffer.alloc(plan.widthPx * plan.heightPx * 3, 0x22),
  format: 24 as const,
  widthPx: plan.widthPx,
  heightPx: plan.heightPx,
});

/** Split a line into Kitty commands: [{ controls, payload }]. */
function commands(line: string) {
  return [...line.matchAll(/\x1b_G([^;\x1b]*)(?:;([^\x1b]*))?\x1b\\/g)].map((m) => ({
    controls: Object.fromEntries(m[1].split(",").map((kv) => kv.split("=") as [string, string])),
    payload: m[2] ?? "",
  }));
}

test("plan matches the cell box and never exceeds the per-image limit", () => {
  const plan = planImage({ natural: { widthPx: 800, heightPx: 400 }, maxColumns: 60, cell, density: 2 });
  assert.equal(plan.columns, 60);
  assert.equal(plan.rows, Math.round((60 * 9 * 0.5) / 18));
  assert.equal(plan.widthPx, 60 * 9 * 2);
  assert.equal(plan.heightPx, plan.rows * 18 * 2);

  const big = planImage({ natural: { widthPx: 4000, heightPx: 4000 }, maxColumns: 200, cell, density: 2, maxImageBytes: 2 * MiB });
  assert.ok(decodedBytes(big.widthPx, big.heightPx) <= 2 * MiB);
});

test("small images are not stretched, and maxRows keeps the aspect ratio", () => {
  const small = planImage({ natural: { widthPx: 90, heightPx: 36 }, maxColumns: 80, cell });
  assert.equal(small.columns, 10);

  const tall = planImage({ natural: { widthPx: 400, heightPx: 1600 }, maxColumns: 80, maxRows: 20, cell });
  assert.equal(tall.rows, 20);
  assert.ok(Math.abs((tall.columns * 9) / (20 * 18) - 0.25) < 0.05);
});

test("defaults to density 1: Rex reports cells in device pixels", () => {
  assert.equal(limitsFromEnv({}).density, 1);
  const plan = planImage({ natural: { widthPx: 1524, heightPx: 938, bitmap: true }, maxColumns: 60, cell: { widthPx: 17, heightPx: 37 } });
  assert.equal(plan.widthPx, 60 * 17);
  assert.ok(decodedBytes(plan.widthPx, plan.heightPx) < 2.5 * MiB, "a 5.5 MiB screenshot fits in under half");
});

test("bitmaps are not upsampled past their own resolution", () => {
  const plan = planImage({ natural: { widthPx: 270, heightPx: 180, bitmap: true }, maxColumns: 80, cell, density: 2 });
  assert.equal(plan.columns, 30);
  assert.equal(plan.widthPx, 270);
});

test("encodes zlib RGB in 4 KiB chunks that pi-tui can parse", () => {
  const w = 300, h = 200;
  const rgb = randomBytes(w * h * 3); // incompressible, so it needs several chunks
  const line = encodeKittyPixels({ data: rgb, format: 24, widthPx: w, heightPx: h }, { id: 42, columns: 30, rows: 6 });
  const cmds = commands(line);
  assert.ok(cmds.length > 1);
  assert.deepEqual(
    { a: cmds[0].controls.a, f: cmds[0].controls.f, o: cmds[0].controls.o, s: cmds[0].controls.s, v: cmds[0].controls.v, i: cmds[0].controls.i, r: cmds[0].controls.r },
    { a: "T", f: "24", o: "z", s: "300", v: "200", i: "42", r: "6" },
  );
  assert.ok(cmds.every((c) => c.payload.length <= 4096));
  assert.equal(cmds.at(-1)!.controls.m, "0");
  const decoded = inflateSync(Buffer.from(cmds.map((c) => c.payload).join(""), "base64"));
  assert.ok(decoded.equals(rgb));
  // pi-tui reads the first command's params up to ';' for i= and r=.
  assert.match(line.slice(0, line.indexOf(";")), /\bi=42\b.*\br=6\b/);
});

test("same owner and size reuses one image and renders once", () => {
  let renders = 0;
  const store = new KittyImageStore({ budgetBytes: 8 * MiB, maxImageBytes: 8 * MiB });
  const plan = planImage({ natural: { widthPx: 400, heightPx: 200 }, maxColumns: 40, cell });
  const a = store.image("diagram-1", plan, (p) => (renders++, rgbOf(p)));
  const b = store.image("diagram-1", plan, (p) => (renders++, rgbOf(p)));
  assert.equal(a, b);
  assert.equal(renders, 1);
  assert.equal(store.stats.images, 1);
});

test("going over budget deletes the least recently used image first", () => {
  const ids = [11, 22, 33, 44];
  const store = new KittyImageStore({ budgetBytes: 3 * MiB, maxImageBytes: 3 * MiB, allocateId: () => ids.shift()! });
  const plan = { columns: 10, rows: 10, widthPx: 512, heightPx: 512 }; // exactly 1 MiB charged
  store.image("a", plan, rgbOf);
  store.image("b", plan, rgbOf);
  store.image("c", plan, rgbOf);
  store.image("a", plan, rgbOf); // touch a: b is now the oldest
  const d = store.image("d", plan, rgbOf);

  const cmds = commands(d);
  assert.equal(cmds[0].controls.i, "44", "the new image comes first on the line");
  const deleted = cmds.filter((c) => c.controls.a === "d").map((c) => c.controls.i);
  assert.deepEqual(deleted, ["22"]);
  assert.equal(cmds.find((c) => c.controls.a === "d")!.controls.d, "I", "uppercase I frees the data");
  assert.ok(store.stats.totalBytes <= 3 * MiB);
});

test("resizing an owner replaces its image instead of adding one", () => {
  let next = 1;
  const store = new KittyImageStore({ budgetBytes: 8 * MiB, maxImageBytes: 8 * MiB, allocateId: () => next++ });
  store.image("a", { columns: 10, rows: 5, widthPx: 170, heightPx: 185 }, rgbOf);
  const resized = store.image("a", { columns: 8, rows: 4, widthPx: 136, heightPx: 148 }, rgbOf);
  const cmds = commands(resized);
  assert.equal(cmds[0].controls.i, "2");
  assert.deepEqual(cmds.filter((c) => c.controls.a === "d").map((c) => c.controls.i), ["1"]);
  assert.equal(store.stats.images, 1);
  assert.equal(store.stats.totalBytes, decodedBytes(136, 148));
});

test("an evicted image comes back under a new ID", () => {
  let next = 1;
  const store = new KittyImageStore({ budgetBytes: 1 * MiB, maxImageBytes: 1 * MiB, allocateId: () => next++ });
  const plan = { columns: 10, rows: 10, widthPx: 512, heightPx: 512 };
  const first = store.image("a", plan, rgbOf);
  store.image("b", plan, rgbOf);
  const again = store.image("a", plan, rgbOf);
  assert.notEqual(commands(again)[0].controls.i, commands(first)[0].controls.i);
});

test("the Rex incident: 19 diagram images stay under budget", () => {
  // Image sizes pi showed in the session whose Rex pane froze: 79 MiB decoded as RGBA PNGs.
  const sizes = [
    [1476, 445], [565, 102], [1500, 984], [840, 780], [1524, 938], [888, 1328], [1524, 938], [888, 1328],
    [1524, 986], [1776, 688], [888, 1328], [1728, 688], [1524, 938], [1728, 688], [780, 360], [1524, 938],
    [1524, 938], [1524, 1181], [1524, 938],
  ];
  const before = sizes.reduce((sum, [w, h]) => sum + w * h * 4, 0);
  assert.ok(before > 64 * MiB);

  const limits = limitsFromEnv({});
  const store = new KittyImageStore(limits);
  const rexCell = { widthPx: 17, heightPx: 37 };
  let peak = 0;
  sizes.forEach(([w, h], i) => {
    // pi's defaults: 60 columns wide, at most as many rows as that is wide.
    const plan = planImage({ natural: { widthPx: w, heightPx: h, bitmap: true }, maxColumns: 60, maxRows: Math.ceil((60 * 17) / 37), cell: rexCell, ...limits });
    store.image(`img-${i}`, plan, rgbOf);
    peak = Math.max(peak, store.stats.totalBytes);
  });
  assert.ok(peak <= limits.budgetBytes, `peak ${peak / MiB} MiB`);
  assert.ok(limits.budgetBytes <= 64 * MiB / 2, "at most half of Rex's limit");
});

test("limits can be tuned from the environment", () => {
  const l = limitsFromEnv({ PI_RICH_MARKDOWN_IMAGE_BUDGET_MB: "8", PI_RICH_MARKDOWN_IMAGE_MAX_MB: "20", PI_RICH_MARKDOWN_IMAGE_DENSITY: "2" });
  assert.deepEqual(l, { budgetBytes: 8 * MiB, maxImageBytes: 8 * MiB, density: 2 });
});

test("rasterizes an SVG into the exact box, centered on the background", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#ff0000"/></svg>`;
  assert.deepEqual(svgNaturalSize(svg), { widthPx: 100, heightPx: 50 });
  const out = rasterizeSvg(svg, { widthPx: 200, heightPx: 200, background: "#21252b", fontFiles: [] });
  assert.equal(out.format, 24);
  assert.equal(out.data.length, 200 * 200 * 3);
  const px = (x: number, y: number) => [...out.data.subarray((y * 200 + x) * 3, (y * 200 + x) * 3 + 3)];
  assert.deepEqual(px(0, 0), [0x21, 0x25, 0x2b], "letterbox uses the background");
  assert.deepEqual(px(100, 100), [255, 0, 0], "content is centered");
});

test("without a background the letterbox stays transparent", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#ff0000"/></svg>`;
  const out = rasterizeSvg(svg, { widthPx: 100, heightPx: 100, fontFiles: [] });
  assert.equal(out.format, 32);
  assert.equal(out.data[3], 0);
});

test("opaque bitmaps become RGB, transparent ones straight-alpha RGBA", () => {
  const png = (fill: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`;
    return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng().toString("base64");
  };
  const opaque = rasterizeBitmap(png("#336699"), "image/png", { widthPx: 20, heightPx: 10 });
  assert.equal(opaque.format, 24);
  assert.deepEqual([...opaque.data.subarray(0, 3)], [0x33, 0x66, 0x99]);

  const seeThrough = rasterizeBitmap(png("rgba(255,255,255,0.5)"), "image/png", { widthPx: 20, heightPx: 10 });
  assert.equal(seeThrough.format, 32);
  const [r, g, b, a] = seeThrough.data.subarray(0, 4);
  assert.deepEqual([r, g, b], [255, 255, 255], "not darkened by premultiplication");
  assert.ok(Math.abs(a - 127.5) <= 1);
});

test("premultiplied pixels pack and flatten correctly", () => {
  const half = Buffer.from([128, 128, 128, 128]); // 50% white, premultiplied
  assert.deepEqual([...pack(half, 1, 1).data], [255, 255, 255, 128]);
  assert.deepEqual([...flatten(half, 1, 1, "#000000").data], [128, 128, 128]);
});
