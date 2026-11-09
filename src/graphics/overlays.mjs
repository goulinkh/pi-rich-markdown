// Keep images out from under overlays (/btw, selectors, dialogs).
//
// pi composites an overlay into the screen lines after layout, but leaves a
// line that carries an image untouched (compositeTuiLine returns image lines
// as they are), and a Kitty image is drawn above text anyway. So an overlay
// over a diagram loses the rows where the image starts and is covered by the
// image everywhere else.
//
// While an overlay covers part of an image, the image is cut around it: the
// rows above the overlay stay where they are, the rows below it are placed
// again as a second placement (p=) of the same image, and the rows the
// overlay covers are left to the overlay. pi deletes every placement and
// redraws all image lines whenever an image line changes, so the cut-out
// disappears as soon as the overlay closes.

const PATCHED = Symbol.for("pi-rich-markdown.overlay-images");
const LOWER_PLACEMENT = 2;

/** Patch compositeOverlays on pi's TUI base class. Returns a function that restores it. */
export function installOverlayImageClip({ tui }) {
  const base = tui.TuiAltScreen && Object.getPrototypeOf(tui.TuiAltScreen.prototype);
  const proto = typeof base?.compositeOverlays === "function" ? base : tui.TuiAltScreen?.prototype;
  if (typeof proto?.compositeOverlays !== "function") throw new Error("pi's overlay compositing changed; images may cover dialogs");
  if (proto.compositeOverlays[PATCHED]) return proto.compositeOverlays[PATCHED];
  const original = proto.compositeOverlays;
  function compositeOverlays(lines, termWidth, termHeight) {
    const result = original.call(this, lines, termWidth, termHeight);
    const layouts = this.renderedOverlayLayouts;
    if (!layouts?.length || !lines.some((l) => l?.includes("\x1b_G"))) return result;
    // Overlay rows are relative to the bottom `termHeight` lines (see compositeOverlays).
    const working = Math.max(lines.length, termHeight, ...layouts.map((o) => o.row + o.height));
    const offset = Math.max(0, working - termHeight);
    const rects = layouts.map((o) => ({ top: o.row + offset, bottom: o.row + offset + o.height, left: o.col, right: o.col + o.width }));
    const clipped = clipImages(lines, rects, tui.visibleWidth);
    return clipped ? original.call(this, clipped, termWidth, termHeight) : result;
  }
  const restore = () => {
    proto.compositeOverlays = original;
  };
  compositeOverlays[PATCHED] = restore;
  proto.compositeOverlays = compositeOverlays;
  return restore;
}

/**
 * Lines with every Kitty image cut around the rectangles that cover it, or
 * undefined when no image is covered. Rectangles: {top, bottom, left, right},
 * rows and columns, end-exclusive.
 */
export function clipImages(lines, rects, visibleWidth) {
  let out;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    const at = line?.indexOf("\x1b_G") ?? -1;
    if (at < 0) continue;
    const image = parseImage(line, at);
    if (!image) continue;
    const prefix = line.slice(0, at);
    const left = visibleWidth(prefix);
    let first = Infinity, last = -1;
    for (const r of rects) {
      if (r.right <= left || r.left >= left + image.columns) continue;
      const from = Math.max(r.top, row), to = Math.min(r.bottom, row + image.rows);
      if (from >= to) continue;
      first = Math.min(first, from - row);
      last = Math.max(last, to - 1 - row);
    }
    if (last < 0) continue;
    out ??= [...lines];
    const above = first, below = image.rows - (last + 1);
    const lower = below > 0 && row + last + 1 < lines.length ? row + last + 1 : -1;
    if (image.heightPx === undefined) {
      // No pixel size to crop by (an image pi drew itself): hide it while covered.
      out[row] = prefix;
      continue;
    }
    const rowsToPx = (n) => Math.round((image.heightPx * n) / image.rows);
    if (above > 0) {
      out[row] = withControls(line, image, { y: image.y, h: rowsToPx(above), r: above });
      if (lower >= 0) {
        const y = image.y + rowsToPx(last + 1);
        const placement = `\x1b_Ga=p,i=${image.id},p=${LOWER_PLACEMENT},c=${image.columns},r=${below},y=${y},h=${image.y + image.heightPx - y},C=1,q=2;\x1b\\`;
        out[lower] = prefix + placement;
      }
    } else {
      out[row] = prefix;
      if (lower >= 0) {
        const y = image.y + rowsToPx(last + 1);
        out[lower] = withControls(line, image, { y, h: image.y + image.heightPx - y, r: below });
      }
    }
  }
  return out;
}

/** The first Kitty command's id, cell box and source rows, or undefined. */
function parseImage(line, at) {
  const end = line.slice(at + 3).search(/[;\x1b]/);
  const controls = line.slice(at + 3, end < 0 ? undefined : at + 3 + end);
  const c = Object.fromEntries(controls.split(",").map((kv) => kv.split("=")));
  const rows = Number(c.r), columns = Number(c.c), id = Number(c.i);
  if (!(rows > 0 && columns > 0 && id > 0)) return undefined;
  const y = Number(c.y ?? 0);
  const heightPx = c.h !== undefined ? Number(c.h) : c.v !== undefined ? Number(c.v) - y : undefined;
  return { id, rows, columns, y, heightPx, controls, at };
}

/** `line` with y=, h= and r= of its first Kitty command replaced. */
function withControls(line, image, { y, h, r }) {
  const kept = image.controls.split(",").filter((kv) => !/^[yhr]=/.test(kv));
  const controls = [...kept, `y=${y}`, `h=${h}`, `r=${r}`].join(",");
  return line.slice(0, image.at + 3) + controls + line.slice(image.at + 3 + image.controls.length);
}
