// Route every image pi draws (tool results such as `read` on a PNG, pasted
// images) through the shared KittyImageStore, so pi's own images obey the same
// size limits as ours.
//
// Without this, pi sends each image as a full-resolution PNG under a new ID,
// and in main-screen mode nothing frees them once they scroll into the
// scrollback. Nineteen screenshots (79 MiB decoded) were enough to push a Rex
// pane past its 64 MiB snapshot limit and freeze it.
//
// Extensions share pi's @earendil-works/pi-tui module instance, so replacing
// Image.prototype.render here changes every Image pi creates.

import { createHash } from "node:crypto";
import { planImage } from "./kitty-images.mjs";
import { rasterizeBitmap } from "./rasterize.mjs";

const PATCHED = Symbol.for("pi-rich-markdown.image-render");
const DECODABLE = new Set(["image/png", "image/jpeg", "image/gif"]);
let owners = 0;

/**
 * Patch `tui.Image` once per process. `tui` is the pi-tui module (or the parts
 * of it used here); `store` is a KittyImageStore; `limits` comes from
 * limitsFromEnv(). Returns a function that restores the original render.
 */
export function installImageBudget({ tui, store, limits }) {
  const proto = tui.Image.prototype;
  if (proto.render[PATCHED]) {
    // /reload: keep the original, swap in the latest store and limits.
    Object.assign(proto.render[PATCHED], { store, limits });
    return proto.render[PATCHED].restore;
  }
  const original = proto.render;
  const state = { store, limits, restore: () => { proto.render = original; } };

  function render(width) {
    if (tui.getCapabilities().images !== "kitty") return original.call(this, width);
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    // Same box pi would use (components/image.js).
    const maxColumns = Math.max(1, Math.min(width - 2, this.options.maxWidthCells ?? 60));
    const cell = tui.getCellDimensions();
    const maxRows = this.options.maxHeightCells ?? Math.max(1, Math.ceil((maxColumns * cell.widthPx) / cell.heightPx));

    let lines;
    try {
      const source = decodableSource(this, original, width);
      const plan = planImage({
        natural: { ...source.dimensions, bitmap: true },
        maxColumns,
        maxRows,
        cell,
        density: state.limits.density,
        maxImageBytes: state.limits.maxImageBytes,
      });
      this[PATCHED] ??= `pi-image:${++owners}:${createHash("sha1").update(source.data).digest("hex").slice(0, 16)}`;
      const sequence = state.store.image(this[PATCHED], plan, (p) => rasterizeBitmap(source.data, source.mimeType, p));
      lines = [sequence, ...Array.from({ length: plan.rows - 1 }, () => "")];
    } catch {
      const fallback = tui.imageFallback(this.mimeType, this.dimensions, this.options.filename);
      lines = [tui.truncateToWidth(this.theme.fallbackColor(fallback), width)];
    }
    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }
  render[PATCHED] = state;
  proto.render = render;
  return state.restore;
}

/**
 * PNG, JPEG and GIF decode directly. Anything else (WebP, ...) goes through
 * pi's own transcoder first: the original render converts and keeps the PNG
 * in `pngData`; its output lines are discarded, nothing is written.
 */
function decodableSource(image, originalRender, width) {
  if (DECODABLE.has(image.mimeType)) return { data: image.base64Data, mimeType: image.mimeType, dimensions: image.dimensions };
  if (!image.pngData) {
    originalRender.call(image, width);
    image.cachedLines = undefined;
  }
  if (!image.pngData) throw new Error(`no decoder for ${image.mimeType}`);
  const dimensions = pngDimensions(image.pngData) ?? image.dimensions;
  return { data: image.pngData, mimeType: "image/png", dimensions };
}

function pngDimensions(base64) {
  const head = Buffer.from(base64.slice(0, 44), "base64");
  if (head.length < 24 || head.readUInt32BE(12) !== 0x49484452) return undefined; // IHDR
  return { widthPx: head.readUInt32BE(16), heightPx: head.readUInt32BE(20) };
}
