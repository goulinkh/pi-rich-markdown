// Render src/preview.md with pi's real Markdown component (from the installed pi).
// Usage: node scripts/render-preview.mjs [width] [--no-images]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const themes = await import(pathToFileURL(join(pi, "dist/modes/interactive/theme/theme.js")).href);
const { installMarkdownRenderer } = await import("../src/markdown/install.mjs");
const { KittyImageStore, limitsFromEnv } = await import("../src/graphics/kitty-images.mjs");
const { installIconRenderer } = await import("../src/icons/render.mjs");
const { iconFontFiles, iconLookup, iconsAvailable, iconStyleFromEnv } = await import("../src/icons/nerd-fonts.mjs");
const width = Number(process.argv[2]) || process.stdout.columns || 100;
themes.initTheme(process.env.THEME ?? "dark");
tui.setCapabilities({ images: process.argv.includes("--no-images") ? null : "kitty", trueColor: true, hyperlinks: true });
tui.setCellDimensions({ widthPx: 17, heightPx: 37 });
const limits = limitsFromEnv();
installMarkdownRenderer({ tui, getTheme: () => themes.theme, store: new KittyImageStore(limits), limits, onError: (e) => console.error("fallback:", e) });
const icons = iconsAvailable() ? iconLookup({ files: iconFontFiles(), style: iconStyleFromEnv() }) : undefined;
installIconRenderer({ tui, getLookup: () => icons });
const md = new tui.Markdown(readFileSync(new URL("../src/preview.md", import.meta.url), "utf8"), 1, 1, themes.getMarkdownTheme());
const lines = md.render(width);
const isImage = (l) => l.includes("\x1b_G");
const over = lines.filter((l) => !isImage(l) && tui.visibleWidth(l) > width);
if (process.argv.includes("--check")) {
  console.log(`${lines.length} lines, ${lines.filter(isImage).length} images, ${over.length} too wide`);
} else process.stdout.write(lines.join("\n") + "\n");
