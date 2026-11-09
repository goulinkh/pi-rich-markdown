// Kitty graphics output that stays inside a terminal's image memory.
//
// Terminals keep every transmitted image *decoded*: a 0.2 MB PNG of a
// 1524x938 diagram costs 5.5 MiB of pixels for as long as it lives. In pi's
// main-screen mode nothing deletes images that scroll into the scrollback, so
// a long session grows without bound. Rex caps a terminal's state at 64 MiB;
// past that the app can no longer attach to the pane and it freezes.
//
// Every image this extension draws goes through a KittyImageStore, which:
//  - rasterizes to the exact pixel box the placement covers (never larger);
//  - sends raw pixels compressed with zlib (o=z) instead of PNG: opaque images
//    as RGB (f=24, 3 bytes per pixel), only images with transparency as RGBA;
//  - keeps one image per owner (a component), so re-renders and resizes
//    replace the previous image instead of adding another;
//  - keeps the total decoded size under a budget, deleting the least recently
//    used images (their scrollback copies go blank) before sending a new one.

import { deflateSync } from "node:zlib";
import { randomInt } from "node:crypto";

const MiB = 1024 * 1024;
const CHUNK = 4096;

/**
 * Bytes a terminal may hold per pixel. We send RGB (3), but count 4 in case a
 * terminal widens to RGBA internally, so the budget holds either way.
 */
export const BUDGET_BYTES_PER_PIXEL = 4;

/**
 * Defaults leave a wide margin under Rex's 64 MiB per-terminal limit.
 * Density 1: Rex, Ghostty and Kitty report cell sizes in device pixels
 * (17x37 on a Retina Mac), so the cell box is already full resolution.
 */
export const DEFAULTS = {
  budgetBytes: 24 * MiB,
  maxImageBytes: 6 * MiB,
  density: 1,
};

function envNumber(env, name) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read overrides from the environment:
 *   PI_RICH_MARKDOWN_IMAGE_BUDGET_MB   total decoded image memory (default 24)
 *   PI_RICH_MARKDOWN_IMAGE_MAX_MB      largest single image (default 6)
 *   PI_RICH_MARKDOWN_IMAGE_DENSITY     pixels per reported cell pixel (default 1)
 */
export function limitsFromEnv(env = process.env) {
  const budgetMb = envNumber(env, "PI_RICH_MARKDOWN_IMAGE_BUDGET_MB");
  const maxMb = envNumber(env, "PI_RICH_MARKDOWN_IMAGE_MAX_MB");
  const budgetBytes = budgetMb ? budgetMb * MiB : DEFAULTS.budgetBytes;
  return {
    budgetBytes,
    maxImageBytes: Math.min(budgetBytes, maxMb ? maxMb * MiB : DEFAULTS.maxImageBytes),
    density: envNumber(env, "PI_RICH_MARKDOWN_IMAGE_DENSITY") ?? DEFAULTS.density,
  };
}

/**
 * Choose the cell box and pixel size for an image.
 *
 * `natural` is the image's own size in CSS/logical pixels (an SVG viewBox or a
 * bitmap's dimensions, with `bitmap: true`). The image never grows past its
 * natural width in cells, and the pixel buffer matches the cell box exactly
 * (times `density`), never above a bitmap's own resolution and shrunk
 * further if it would exceed `maxImageBytes`.
 */
export function planImage({ natural, maxColumns, maxRows = Infinity, cell, density = DEFAULTS.density, maxImageBytes = DEFAULTS.maxImageBytes }) {
  const aspect = natural.heightPx / natural.widthPx;
  let columns = Math.max(1, Math.min(maxColumns, Math.ceil(natural.widthPx / cell.widthPx)));
  let rows = Math.max(1, Math.round((columns * cell.widthPx * aspect) / cell.heightPx));
  if (rows > maxRows) {
    rows = Math.max(1, Math.floor(maxRows));
    columns = Math.max(1, Math.min(columns, Math.round((rows * cell.heightPx) / aspect / cell.widthPx)));
  }
  const boxW = columns * cell.widthPx;
  const boxH = rows * cell.heightPx;
  // Density beyond the natural resolution adds bytes but no detail for bitmaps.
  let scale = Math.min(density, natural.bitmap ? Math.max(1, natural.widthPx / boxW, natural.heightPx / boxH) : density);
  const bytesAt = (s) => Math.round(boxW * s) * Math.round(boxH * s) * BUDGET_BYTES_PER_PIXEL;
  if (bytesAt(scale) > maxImageBytes) scale = Math.sqrt(maxImageBytes / (boxW * boxH * BUDGET_BYTES_PER_PIXEL));
  const widthPx = Math.max(1, Math.floor(boxW * scale));
  const heightPx = Math.max(1, Math.floor(boxH * scale));
  return { columns, rows, widthPx, heightPx };
}

/** Decoded bytes an image is charged against the budget. */
export function decodedBytes(widthPx, heightPx) {
  return widthPx * heightPx * BUDGET_BYTES_PER_PIXEL;
}

/** Kitty command that deletes an image and frees its data (uppercase I). */
export function deleteImage(id) {
  return `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
}

/**
 * Pixels for the encoder: `format` 24 is packed RGB, 32 is RGBA.
 * @typedef {{ data: Buffer, format: 24 | 32, widthPx: number, heightPx: number }} Pixels
 */

/**
 * Transmit-and-place command for raw pixels, zlib-compressed.
 * The first command carries i= and r=, which is what pi-tui parses to track
 * the image and reserve its rows.
 */
export function encodeKittyPixels({ data, format, widthPx, heightPx }, { id, columns, rows }) {
  const expected = widthPx * heightPx * (format / 8);
  if (data.length !== expected) throw new Error(`expected ${expected} bytes for f=${format}, got ${data.length}`);
  const payload = deflateSync(data, { level: 6 }).toString("base64");
  const head = `a=T,f=${format},o=z,s=${widthPx},v=${heightPx},i=${id},c=${columns},r=${rows},C=1,q=2`;
  if (payload.length <= CHUNK) return `\x1b_G${head};${payload}\x1b\\`;
  let out = "";
  for (let at = 0; at < payload.length; at += CHUNK) {
    const more = at + CHUNK < payload.length ? 1 : 0;
    out += `\x1b_G${at === 0 ? `${head},` : ""}m=${more};${payload.slice(at, at + CHUNK)}\x1b\\`;
  }
  return out;
}

function defaultAllocateId(live) {
  // Kitty IDs are 32-bit; random IDs avoid clashing with pi's own images.
  for (;;) {
    const id = randomInt(1, 0xffffffff);
    if (!live.has(id)) return id;
  }
}

/**
 * Tracks the images this process has sent to the terminal.
 *
 * `image(owner, plan, render)` returns the escape sequence for one image line.
 * `owner` identifies one on-screen image (a component instance plus whatever
 * it draws); two owners never share an image ID, so redrawing one cannot
 * disturb the other. `render(plan)` is only called when the owner has no
 * image of that size yet and must return Pixels matching the plan.
 */
export class KittyImageStore {
  constructor({ budgetBytes = DEFAULTS.budgetBytes, maxImageBytes = DEFAULTS.maxImageBytes, allocateId, onTransmit } = {}) {
    this.budgetBytes = budgetBytes;
    this.maxImageBytes = Math.min(maxImageBytes, budgetBytes);
    this.allocateId = allocateId ?? (() => defaultAllocateId(this.liveIds));
    this.onTransmit = onTransmit;
    /** owner -> { id, bytes, size, sequence }, least recently used first. */
    this.live = new Map();
    this.liveIds = new Set();
    this.totalBytes = 0;
  }

  get stats() {
    return { images: this.live.size, totalBytes: this.totalBytes, budgetBytes: this.budgetBytes };
  }

  #drop(owner, entry) {
    this.live.delete(owner);
    this.liveIds.delete(entry.id);
    this.totalBytes -= entry.bytes;
    return deleteImage(entry.id);
  }

  image(owner, plan, render) {
    const size = `${plan.columns}x${plan.rows}@${plan.widthPx}x${plan.heightPx}`;
    const current = this.live.get(owner);
    if (current?.size === size) {
      this.live.delete(owner);
      this.live.set(owner, current);
      return current.sequence;
    }

    const bytes = decodedBytes(plan.widthPx, plan.heightPx);
    if (bytes > this.maxImageBytes) throw new Error(`image ${plan.widthPx}x${plan.heightPx} exceeds the ${this.maxImageBytes} byte limit; plan it with planImage()`);

    const pixels = render(plan);
    if (pixels.widthPx !== plan.widthPx || pixels.heightPx !== plan.heightPx) {
      throw new Error(`render returned ${pixels.widthPx}x${pixels.heightPx}, planned ${plan.widthPx}x${plan.heightPx}`);
    }

    // A resized owner replaces its old image; then evict the least recently
    // used until the new one fits, so the terminal never exceeds the budget.
    let deletions = current ? this.#drop(owner, current) : "";
    for (const [oldOwner, old] of this.live) {
      if (this.totalBytes + bytes <= this.budgetBytes) break;
      deletions += this.#drop(oldOwner, old);
    }

    // IDs are never reused after a delete: a line that still carries an old
    // deletion can be re-emitted later without wiping a newer image.
    const id = this.allocateId();
    // Deletions go after the image: pi-tui reads the first Kitty command of a
    // line as the line's image, and repeating them later is harmless.
    const sequence = encodeKittyPixels(pixels, { id, columns: plan.columns, rows: plan.rows }) + deletions;
    this.live.set(owner, { id, bytes, size, sequence });
    this.liveIds.add(id);
    this.totalBytes += bytes;
    this.onTransmit?.({ imageId: id, columns: plan.columns, rows: plan.rows, widthPx: plan.widthPx, heightPx: plan.heightPx });
    return sequence;
  }
}

/** One store per process, shared by every pi image and by Markdown rendering, and kept across /reload. */
export function sharedImageStore(options) {
  const slot = Symbol.for("pi-rich-markdown.kitty-image-store");
  globalThis[slot] ??= new KittyImageStore(options);
  return globalThis[slot];
}
