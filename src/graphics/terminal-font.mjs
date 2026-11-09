// The terminal's own font, for text inside diagrams.
//
// Rex keeps its font in macOS preferences (Workspace.terminalFontName). We
// find the font files for that family by reading each candidate's name table,
// so "Maple Mono NF" resolves to MapleMono-NF-*.ttf and not to "Maple Mono".
// PI_RICH_MARKDOWN_FONT overrides the family on any terminal.

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const FONT_DIRS = [
  join(homedir(), "Library/Fonts"), "/Library/Fonts", "/System/Library/Fonts",
  join(homedir(), ".local/share/fonts"), join(homedir(), ".fonts"), "/usr/share/fonts", "/usr/local/share/fonts",
];
const FONT_EXT = new Set([".ttf", ".otf", ".ttc"]);

/** Family name of the terminal font, or undefined when unknown. */
export function terminalFontFamily({ env = process.env, platform = process.platform, run = execFileSync } = {}) {
  if (env.PI_RICH_MARKDOWN_FONT) return env.PI_RICH_MARKDOWN_FONT;
  if (env.TERM_PROGRAM !== "rex" || platform !== "darwin") return undefined;
  try {
    const name = run("defaults", ["read", "com.superlogical.rex", "Workspace.terminalFontName"], {
      encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Upright font files of `family` (italics are left out: diagrams don't use
 * them and every file costs load time on each rasterization).
 */
export function findFontFiles(family, { dirs = FONT_DIRS } = {}) {
  const want = squash(family);
  const firstWord = squash(family.split(/\s+/)[0] ?? "");
  const files = dirs.flatMap((dir) => listFonts(dir));
  const byName = files.filter((f) => squash(f.split("/").pop()).startsWith(firstWord));
  const matches = (list) => list.filter((f) => !/italic|oblique/i.test(f) && fontFamilies(f).some((n) => squash(n) === want));
  const found = matches(byName);
  return found.length ? found : matches(files.filter((f) => !byName.includes(f)));
}

function listFonts(dir, depth = 0) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return depth < 3 ? listFonts(path, depth + 1) : [];
    return FONT_EXT.has(extname(e.name).toLowerCase()) ? [path] : [];
  });
}

/**
 * Code points a font file can draw: the union of its cmap format 4 (BMP) and
 * format 12 (full Unicode) subtables, first face only for collections.
 * Empty when the file cannot be read.
 */
export function fontCoverage(path) {
  const covered = new Set();
  let b;
  try {
    b = readFileSync(path);
    const face = b.toString("latin1", 0, 4) === "ttcf" ? b.readUInt32BE(12) : 0;
    let cmap;
    for (let i = 0, n = b.readUInt16BE(face + 4); i < n; i++) {
      const t = face + 12 + i * 16;
      if (b.toString("latin1", t, t + 4) === "cmap") cmap = b.readUInt32BE(t + 8);
    }
    if (cmap === undefined) return covered;
    for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
      const off = cmap + b.readUInt32BE(cmap + 4 + i * 8 + 4);
      const format = b.readUInt16BE(off);
      if (format === 12) {
        for (let g = 0, groups = b.readUInt32BE(off + 12); g < groups; g++) {
          const p = off + 16 + g * 12;
          for (let cp = b.readUInt32BE(p), end = b.readUInt32BE(p + 4); cp <= end; cp++) covered.add(cp);
        }
      } else if (format === 4) {
        const segments = b.readUInt16BE(off + 6) / 2;
        for (let s = 0; s < segments; s++) {
          const end = b.readUInt16BE(off + 14 + s * 2);
          const start = b.readUInt16BE(off + 16 + segments * 2 + s * 2);
          for (let cp = start; cp <= end && cp !== 0xffff; cp++) covered.add(cp);
        }
      }
    }
  } catch {
    // Unreadable or truncated: whatever was collected so far.
  }
  return covered;
}

/** Family names (name IDs 1 and 16) of every face in a TTF, OTF or TTC file. */
export function fontFamilies(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const read = (offset, length) => {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
      readSync(fd, buf, 0, buf.length, offset);
      return buf;
    };
    const head = read(0, 12);
    const faces = head.toString("latin1", 0, 4) === "ttcf"
      ? Array.from({ length: Math.min(head.readUInt32BE(8), 64) }, (_, i) => read(12 + 4 * i, 4).readUInt32BE(0))
      : [0];
    const names = new Set();
    for (const face of faces) {
      const dir = read(face, 12);
      const tables = read(face + 12, dir.readUInt16BE(4) * 16);
      for (let t = 0; t + 16 <= tables.length; t += 16) {
        if (tables.toString("latin1", t, t + 4) !== "name") continue;
        const table = read(tables.readUInt32BE(t + 8), tables.readUInt32BE(t + 12));
        const count = table.readUInt16BE(2), strings = table.readUInt16BE(4);
        for (let r = 6; r + 12 <= 6 + count * 12; r += 12) {
          const [platform, , , nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => table.readUInt16BE(r + o));
          if (nameId !== 1 && nameId !== 16) continue;
          const raw = table.subarray(strings + offset, strings + offset + length);
          names.add(platform === 1 ? raw.toString("latin1") : raw.swap16().toString("utf16le"));
        }
      }
    }
    return [...names];
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
