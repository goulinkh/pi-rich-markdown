// Regenerate src/icons/nerd-font-names.json from the official Nerd Fonts
// glyph list. Usage: node scripts/update-icons.mjs [path/to/glyphnames.json]
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/glyphnames.json";
const raw = process.argv[2] ? readFileSync(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
const { METADATA, ...glyphs } = JSON.parse(raw);
const icons = Object.fromEntries(
  Object.entries(glyphs)
    .map(([name, { code }]) => [name, code.toLowerCase()])
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);
const out = new URL("../src/icons/nerd-font-names.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ version: METADATA.version, source: SOURCE, icons })}\n`);
console.log(`Nerd Fonts ${METADATA.version}: ${Object.keys(icons).length} icons → ${out.pathname}`);
