// Diagram colors derived from the terminal's background and foreground.
// Every derived color sits at a fixed contrast step from the background, so
// diagrams stay legible on any theme instead of fading into it.

export function parseHex(value) {
  let h = String(value).trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

export function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

const srgbToLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

function toOklab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb);
}

/** Mix `amount` of `b` into `a` (0 → a, 1 → b) in OKLab, so equal steps look equally far apart. */
export function mix(a, b, amount) {
  const ca = toOklab(parseHex(a)), cb = toOklab(parseHex(b));
  return toHex(fromOklab(ca.map((v, i) => v + (cb[i] - v) * amount)));
}

/**
 * Contrast steps, as the share of foreground mixed into the background.
 * The old beautiful-mermaid defaults were 3% (node fill) and 20% (node stroke),
 * which vanish on dark terminals.
 */
export const CONTRAST = {
  card: 0.045,      // panel behind the whole diagram
  surface: 0.12,    // node fill
  groupHeader: 0.08,
  border: 0.42,     // node stroke
  line: 0.6,        // connectors
  muted: 0.72,      // edge labels, secondary text
  innerStroke: 0.2,
  keyBadge: 0.16,
};

/** Light backgrounds compress small steps, so fills and hairlines need larger ones. */
const LIGHT_BOOST = { card: 1.2, surface: 1.6, groupHeader: 1.5, innerStroke: 1.3, keyBadge: 1.3 };

export function isLight(hex) {
  return toOklab(parseHex(hex))[0] > 0.6;
}

export function diagramColors({ background, foreground, accent }) {
  const boost = isLight(background) ? LIGHT_BOOST : {};
  const at = (k) => mix(background, foreground, Math.min(1, CONTRAST[k] * (boost[k] ?? 1)));
  return {
    bg: background,
    fg: foreground,
    accent: accent ?? mix(background, foreground, 0.9),
    card: at("card"),
    surface: at("surface"),
    border: at("border"),
    line: at("line"),
    muted: at("muted"),
    groupHeader: at("groupHeader"),
    innerStroke: at("innerStroke"),
    keyBadge: at("keyBadge"),
  };
}

/** Thicken hairlines: at terminal pixel density 1px strokes read as faint. */
export function strengthenStrokes(svg, factor = 1.6) {
  return svg.replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(Number(w) * factor).toFixed(2)}"`);
}

/** Wrap an SVG in a rounded card so the diagram reads as one object on the terminal background. */
export function addCard(svg, color, { padding = 12, radius = 10 } = {}) {
  const m = /<svg\b[^>]*\bviewBox="([\d.\s-]+)"/.exec(svg);
  if (!m) return svg;
  const [x, y, w, h] = m[1].trim().split(/\s+/).map(Number);
  const W = w + padding * 2, H = h + padding * 2;
  const inner = svg.replace(/^<\?xml[^>]*>\s*/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${radius}" fill="${color}"/>`
    + `<svg x="${padding}" y="${padding}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`
    + inner.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")
    + `</svg></svg>`;
}

/**
 * Give free-floating labels a halo in the panel color so connectors and
 * lifelines never cut through them (e.g. a sequence message label sitting on
 * a lifeline). Text inside filled nodes is left alone: a panel-colored halo
 * there would draw a dark outline on the node fill.
 * Uses attributes rather than CSS because resvg ignores paint-order in stylesheets.
 */
export function haloText(svg, color, { labelFill, width = 4 } = {}) {
  // Labels drawn on their own badge (flowchart edge labels) are already separated.
  const badged = new Set();
  for (const m of svg.matchAll(/<g class="edge-label"[^>]*>\s*<rect\b[^>]*>\s*<text\b/g)) badged.add(m.index + m[0].length - 5);
  return svg.replace(/<text\b([^>]*)>/g, (tag, attrs, offset) => {
    if (badged.has(offset) || /\bstroke=/.test(attrs)) return tag;
    const fill = /\bfill="([^"]*)"/.exec(attrs)?.[1];
    if (labelFill && fill?.toLowerCase() !== labelFill.toLowerCase()) return tag;
    return `<text paint-order="stroke" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"${attrs}>`;
  });
}
