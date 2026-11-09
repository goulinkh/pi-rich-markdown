// Nerd Font icons written as :nf-<set>-<name>: shortcodes.
//
// Models cannot reliably recall private-use code points, but they know the
// official cheat-sheet names (nf-md-check_circle, nf-dev-rust…). Messages keep
// the shortcode; only the terminal display swaps it for the glyph, so the
// session, the model's context and other terminals see readable text.

import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findFontFiles, fontCoverage, terminalFontFamily } from "../graphics/terminal-font.mjs";

/** `:nf-md-check_circle:` → name "md-check_circle". */
export const SHORTCODE = /:nf-([a-z]+-[a-z0-9_]+):/g;

/** Terminals that ship Symbols Nerd Font as a built-in fallback. */
const BUNDLED = new Set(["rex", "ghostty", "wezterm"]);

let names;

/** Icon name (without "nf-") → code point, from the official glyph list. */
export function iconNames() {
  if (!names) {
    const { icons } = JSON.parse(readFileSync(new URL("./nerd-font-names.json", import.meta.url), "utf8"));
    names = new Map(Object.entries(icons).map(([name, hex]) => [name, Number.parseInt(hex, 16)]));
  }
  return names;
}

/**
 * Whether this terminal can draw Nerd Font icons. PI_RICH_MARKDOWN_ICONS=1/0
 * decides; otherwise yes for terminals with a built-in Nerd Font fallback or
 * a terminal font that is a Nerd Font.
 */
export function iconsAvailable({ env = process.env, family = () => terminalFontFamily({ env }) } = {}) {
  const forced = env.PI_RICH_MARKDOWN_ICONS?.trim().toLowerCase();
  if (forced) return !["0", "off", "false", "no"].includes(forced);
  if (BUNDLED.has(env.TERM_PROGRAM?.toLowerCase()) || env.TERM === "xterm-kitty" || env.KITTY_WINDOW_ID) return true;
  return /nerd|\bNF\b/i.test(family() ?? "");
}

/**
 * Font files whose glyphs the terminal can draw icons from: the terminal
 * font and Rex's bundled fallback. Empty when unknown (other terminals keep
 * their fonts out of reach).
 */
export function iconFontFiles({ env = process.env, apps = ["/Applications", join(homedir(), "Applications")] } = {}) {
  const family = terminalFontFamily({ env });
  // Every weight of a family carries the same icons; one file is enough.
  const faces = family ? findFontFiles(family) : [];
  const files = faces.length ? [faces.find((f) => /regular/i.test(f)) ?? faces[0]] : [];
  if (env.TERM_PROGRAM?.toLowerCase() === "rex") files.push(...rexSymbolFonts(apps));
  return files;
}

function rexSymbolFonts(apps) {
  const list = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  return apps.flatMap((dir) => list(dir).filter((app) => /^Rex\b.*\.app$/.test(app)).flatMap((app) => {
    const resources = join(dir, app, "Contents/Resources");
    return list(resources).filter((b) => b.endsWith(".bundle")).flatMap((bundle) => {
      const inner = join(resources, bundle, "Contents/Resources");
      return list(inner).filter((f) => /^SymbolsNerdFont.*\.(ttf|otf)$/i.test(f)).map((f) => join(inner, f));
    });
  }));
}

export const ICON_STYLES = ["outline", "filled", "as-written"];

/** PI_RICH_MARKDOWN_ICON_STYLE: outline (default), filled or as-written. */
export function iconStyleFromEnv(env = process.env) {
  const style = env.PI_RICH_MARKDOWN_ICON_STYLE?.trim().toLowerCase();
  return ICON_STYLES.includes(style) ? style : "outline";
}

/**
 * The names to try for `name` in `style`, best first. Each icon set marks
 * its variants differently: Material Design adds `_outline` to the filled
 * base name, Font Awesome adds `_o`, Octicons are outlined by default and
 * add `_fill`.
 */
export function styledNames(name, style) {
  if (style === "outline") {
    if (name.startsWith("md-") && !name.endsWith("_outline")) return [`${name}_outline`, name];
    if ((name.startsWith("fa-") || name.startsWith("fae-")) && !name.endsWith("_o")) return [`${name}_o`, name];
    if (name.startsWith("oct-") && name.endsWith("_fill")) return [name.slice(0, -5), name];
  } else if (style === "filled") {
    if (name.startsWith("md-") && name.endsWith("_outline")) return [name.slice(0, -8), name];
    if ((name.startsWith("fa-") || name.startsWith("fae-")) && name.endsWith("_o")) return [name.slice(0, -2), name];
    if (name.startsWith("oct-") && !name.endsWith("_fill")) return [`${name}_fill`, name];
  }
  return [name];
}

/**
 * `(name) => glyph | undefined`. With font files, only icons those fonts
 * contain resolve: an icon newer than the font stays readable text instead
 * of an empty box. `style` swaps in the outlined or filled variant of an
 * icon when the set has one the fonts can draw.
 */
export function iconLookup({ files = [], style = "as-written" } = {}) {
  const covered = new Set();
  for (const file of files) for (const cp of fontCoverage(file)) covered.add(cp);
  const all = iconNames();
  const drawable = (name) => {
    const cp = all.get(name);
    return cp !== undefined && (covered.size === 0 || covered.has(cp)) ? cp : undefined;
  };
  return (name) => {
    if (!all.has(name)) return undefined;
    for (const candidate of styledNames(name, style)) {
      const cp = drawable(candidate);
      if (cp !== undefined) return String.fromCodePoint(cp);
    }
    return undefined;
  };
}

/** Replace every known shortcode in plain text; unknown names stay as written. */
/**
 * Markdown without the shortcodes `lookup` draws as icons, for text that
 * leaves the terminal (a copied selection). Code and unknown names stay.
 */
export function stripIcons(text, lookup, codeRanges = []) {
  if (!text.includes(":nf-")) return text;
  const inCode = (i) => codeRanges.some(([s, e]) => i >= s && i < e);
  return text.replace(/( ?):nf-([a-z]+-[a-z0-9_]+):( ?)/g, (match, before, name, after, at) => {
    if (inCode(at + before.length) || !lookup(name)) return match;
    return before && after ? " " : "";
  });
}

export function iconize(text, lookup) {
  if (!text.includes(":nf-")) return text;
  return text.replace(SHORTCODE, (match, name) => lookup(name) ?? match);
}
