// Turn SVG or bitmap images into pixels sized to a planned box, for
// KittyImageStore. Opaque results are packed as RGB (3 bytes per pixel in the
// terminal); only images that keep transparency are sent as RGBA.

import { Resvg } from "@resvg/resvg-js";
import { parseHex } from "./diagram-theme.mjs";

const NO_FONTS = { loadSystemFonts: false };

/** Natural size of an SVG from its width/height attributes or viewBox. */
export function svgNaturalSize(svg) {
  const tag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const num = (name) => Number.parseFloat(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`).exec(tag)?.[1] ?? "");
  let widthPx = num("width"), heightPx = num("height");
  if (!(widthPx > 0 && heightPx > 0)) {
    const vb = /\bviewBox="([^"]+)"/.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
    if (vb?.length === 4) [, , widthPx, heightPx] = vb;
  }
  return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined;
}

/**
 * Render `svg` scaled to fit inside the box, centered. With `background`
 * the result is flattened onto it (RGB); without, the margins stay
 * transparent (RGBA). Pass `fontFiles` to skip the slow system font scan.
 */
export function rasterizeSvg(svg, { widthPx, heightPx, background, fontFiles, defaultFontFamily }) {
  const natural = svgNaturalSize(svg) ?? { widthPx, heightPx };
  const fit = natural.widthPx / natural.heightPx >= widthPx / heightPx
    ? { mode: "width", value: widthPx }
    : { mode: "height", value: heightPx };
  const font = fontFiles ? { loadSystemFonts: false, fontFiles, defaultFontFamily } : { loadSystemFonts: true, defaultFontFamily };
  const rendered = new Resvg(svg, { fitTo: fit, background, font }).render();
  const rgba = place(rendered.pixels, rendered.width, rendered.height, widthPx, heightPx);
  return background ? flatten(rgba, widthPx, heightPx, background) : pack(rgba, widthPx, heightPx);
}

/**
 * Decode a base64 PNG, JPEG or GIF and scale it to fill the box exactly,
 * the way pi sizes images to whole cells.
 */
export function rasterizeBitmap(base64, mimeType, { widthPx, heightPx }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthPx}" height="${heightPx}">`
    + `<image width="${widthPx}" height="${heightPx}" preserveAspectRatio="none" xlink:href="data:${mimeType};base64,${base64}"/></svg>`;
  const rendered = new Resvg(svg, { font: NO_FONTS }).render();
  if (rendered.width !== widthPx || rendered.height !== heightPx) throw new Error(`decoded ${rendered.width}x${rendered.height}, wanted ${widthPx}x${heightPx}`);
  const pixels = rendered.pixels;
  // resvg draws nothing, without an error, when it cannot decode the image.
  if (isBlank(pixels)) throw new Error(`could not decode ${mimeType}`);
  return pack(pixels, widthPx, heightPx);
}

function isBlank(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}

/** Copy RGBA pixels into the center of a transparent box. */
function place(src, srcW, srcH, widthPx, heightPx) {
  if (srcW === widthPx && srcH === heightPx) return src;
  const out = Buffer.alloc(widthPx * heightPx * 4);
  const w = Math.min(srcW, widthPx), h = Math.min(srcH, heightPx);
  const dx = Math.floor((widthPx - w) / 2), dy = Math.floor((heightPx - h) / 2);
  for (let y = 0; y < h; y++) src.copy(out, ((y + dy) * widthPx + dx) * 4, y * srcW * 4, (y * srcW + w) * 4);
  return out;
}

// resvg returns premultiplied RGBA; Kitty expects straight alpha.

/** RGB when every pixel is opaque, straight-alpha RGBA otherwise. */
export function pack(rgba, widthPx, heightPx) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 255) continue;
    const out = Buffer.from(rgba);
    for (let p = 0; p < out.length; p += 4) {
      const a = out[p + 3];
      if (a === 0 || a === 255) continue;
      for (let c = p; c < p + 3; c++) out[c] = Math.min(255, Math.round((out[c] * 255) / a));
    }
    return { data: out, format: 32, widthPx, heightPx };
  }
  const rgb = Buffer.alloc(widthPx * heightPx * 3);
  for (let s = 0, d = 0; s < rgba.length; s += 4, d += 3) { rgb[d] = rgba[s]; rgb[d + 1] = rgba[s + 1]; rgb[d + 2] = rgba[s + 2]; }
  return { data: rgb, format: 24, widthPx, heightPx };
}

/** Blend premultiplied RGBA onto a solid background and pack as RGB. */
export function flatten(rgba, widthPx, heightPx, background) {
  const [br, bg, bb] = parseHex(background);
  const rgb = Buffer.alloc(widthPx * heightPx * 3);
  for (let s = 0, d = 0; s < rgba.length; s += 4, d += 3) {
    const k = 1 - rgba[s + 3] / 255;
    rgb[d] = Math.round(rgba[s] + br * k);
    rgb[d + 1] = Math.round(rgba[s + 1] + bg * k);
    rgb[d + 2] = Math.round(rgba[s + 2] + bb * k);
  }
  return { data: rgb, format: 24, widthPx, heightPx };
}
