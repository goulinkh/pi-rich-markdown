// Nerd Font icon shortcodes: lookup, terminal rendering, and the guard that
// keeps them out of files and other tool input.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { iconize, iconLookup, iconNames, iconsAvailable, iconStyleFromEnv, styledNames, stripIcons } from "../src/icons/nerd-fonts.mjs";
import { installIconRenderer } from "../src/icons/render.mjs";
import { createIconGuard, iconShortcodes, shortcodesAdded, markdownCodeRanges } from "../src/icons/guard.mjs";
import { fontCoverage } from "../src/graphics/terminal-font.mjs";
import { installMarkdownRenderer } from "../src/markdown/install.mjs";
import { KittyImageStore, limitsFromEnv } from "../src/graphics/kitty-images.mjs";
import { renderingSection } from "../src/prompt.mjs";
import { BUNDLED_FONT } from "../src/markdown/diagram-font.mjs";

const CHECK = "\u{F012C}"; // nf-md-check
const RUST = "\ue7a8"; // nf-dev-rust
const lookup = iconLookup();

test("shortcodes resolve to official code points; unknown names stay as written", () => {
  assert.equal(iconNames().get("md-check"), 0xf012c);
  assert.equal(iconize("done :nf-md-check: in :nf-dev-rust:", lookup), `done ${CHECK} in ${RUST}`);
  assert.equal(iconize(":nf-md-sparkles: :nf-md-check", lookup), ":nf-md-sparkles: :nf-md-check");
});

test("icons are available on terminals with a bundled Nerd Font, or with a Nerd Font", () => {
  const none = () => undefined;
  assert.equal(iconsAvailable({ env: { TERM_PROGRAM: "rex" }, family: none }), true);
  assert.equal(iconsAvailable({ env: { TERM_PROGRAM: "ghostty" }, family: none }), true);
  assert.equal(iconsAvailable({ env: { TERM: "xterm-kitty" }, family: none }), true);
  assert.equal(iconsAvailable({ env: { TERM_PROGRAM: "Apple_Terminal" }, family: none }), false);
  assert.equal(iconsAvailable({ env: {}, family: () => "JetBrainsMono Nerd Font" }), true);
  assert.equal(iconsAvailable({ env: {}, family: () => "Maple Mono NF" }), true);
  assert.equal(iconsAvailable({ env: { TERM_PROGRAM: "rex", PI_RICH_MARKDOWN_ICONS: "0" }, family: none }), false);
  assert.equal(iconsAvailable({ env: { PI_RICH_MARKDOWN_ICONS: "1" }, family: none }), true);
});

test("outline style swaps in each set's outlined variant, when one exists", () => {
  const glyph = (name: string) => String.fromCodePoint(iconNames().get(name));
  const outline = iconLookup({ style: "outline" });
  assert.equal(outline("md-check_circle"), glyph("md-check_circle_outline"));
  assert.equal(outline("md-check_circle_outline"), glyph("md-check_circle_outline"));
  assert.equal(outline("fa-heart"), glyph("fa-heart_o"));
  assert.equal(outline("oct-check_circle_fill"), glyph("oct-check_circle"));
  assert.equal(outline("md-language_typescript"), glyph("md-language_typescript"), "no outline variant: as written");
  assert.equal(outline("md-no_such_icon"), undefined, "an unknown name never resolves through a variant");
  const filled = iconLookup({ style: "filled" });
  assert.equal(filled("md-alert_outline"), glyph("md-alert"));
  assert.equal(filled("fa-star_o"), glyph("fa-star"));
  assert.equal(filled("oct-alert"), glyph("oct-alert_fill"));
  assert.equal(iconLookup({ style: "as-written" })("md-alert"), glyph("md-alert"));
  assert.deepEqual(styledNames("cod-check", "outline"), ["cod-check"]);
});

test("the icon style defaults to outline", () => {
  assert.equal(iconStyleFromEnv({}), "outline");
  assert.equal(iconStyleFromEnv({ PI_RICH_MARKDOWN_ICON_STYLE: "Filled" }), "filled");
  assert.equal(iconStyleFromEnv({ PI_RICH_MARKDOWN_ICON_STYLE: "as-written" }), "as-written");
  assert.equal(iconStyleFromEnv({ PI_RICH_MARKDOWN_ICON_STYLE: "bold" }), "outline");
});

test("only icons the terminal's fonts contain resolve", () => {
  const plain = BUNDLED_FONT.fontFiles[0]; // Maple Mono without Nerd Font glyphs
  const covered = fontCoverage(plain);
  assert.ok(covered.has(0x41) && !covered.has(0xf012c));
  assert.equal(iconLookup({ files: [plain] })("md-check"), undefined);
});

// Rendering with pi's real Markdown component.
const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const themes = await import(pathToFileURL(join(pi, "dist/modes/interactive/theme/theme.js")).href);
let iconsOn = true;
const render = (text: string, width = 60) =>
  new tui.Markdown(text, 0, 0, themes.getMarkdownTheme()).render(width).map((l: string) => tui.stripTerminalSequences(l).trimEnd());

describe("rendering", () => {
  const restore: Array<() => void> = [];
  before(() => {
    themes.initTheme("dark");
    tui.setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const limits = limitsFromEnv({});
    restore.push(installMarkdownRenderer({ tui, limits, store: new KittyImageStore(limits), getTheme: () => themes.theme }));
    restore.push(installIconRenderer({ tui, getLookup: () => (iconsOn ? lookup : undefined) }));
  });
  after(() => restore.reverse().forEach((r) => r()));

  test("icons render in prose, headings, emphasis, lists and links", () => {
    const out = render("## :nf-md-check: Done\n\n- **:nf-dev-rust: Rust** and *:nf-md-check: ok*\n- [:nf-md-check: docs](https://example.com/:nf-md-check:)").join("\n");
    assert.match(out, new RegExp(`${CHECK} Done`));
    assert.match(out, new RegExp(`${RUST} Rust`));
    assert.match(out, new RegExp(`${CHECK} ok`));
    assert.match(out, new RegExp(`${CHECK} docs`));
    assert.doesNotMatch(out, /:nf-md-check:\s*(Done|ok|docs)/);
  });

  test("code spans, code blocks and escapes keep the literal shortcode", () => {
    const out = render("Use `:nf-md-check:` or \\:nf-md-check: here.\n\n```\n:nf-md-check: in a block\n```").join("\n");
    assert.match(out, /`?:nf-md-check:`? or :nf-md-check: here/);
    assert.match(out, /:nf-md-check: in a block/);
    assert.ok(!out.includes(CHECK));
  });

  test("tables measure the icon, not the shortcode", () => {
    const lines = render("| A | B |\n|---|---|\n| :nf-md-check: | x |\n| no | y |");
    const col = (needle: string) => {
      const line = lines.find((l: string) => l.includes(needle)) ?? "";
      return tui.visibleWidth(line.slice(0, line.indexOf(needle)));
    };
    assert.equal(col("x"), col("y"));
  });

  test("without icon support shortcodes render as written", () => {
    iconsOn = false;
    try {
      assert.match(render("ok :nf-md-check:").join("\n"), /ok :nf-md-check:/);
    } finally {
      iconsOn = true;
    }
  });
});

// The guard.
test("quoted mentions and Markdown code are literal, not icons", () => {
  assert.deepEqual(iconShortcodes("a :nf-md-check: b `:nf-dev-rust:` ':nf-oct-x:' \":nf-oct-x:\""), ["md-check"]);
  const md = "Write `:nf-md-check:` like:\n\n```\n- :nf-md-check: done\n```\n\n- :nf-dev-rust: real";
  assert.deepEqual(iconShortcodes(md, { markdown: true }), ["dev-rust"]);
});

test("writing or editing in new shortcodes is caught; keeping existing ones is not", () => {
  const readFile = (path: string) => (path === "old.md" ? "- :nf-md-check: done\n" : undefined);
  assert.deepEqual(shortcodesAdded("write", { path: "README.md", content: "# :nf-md-rocket: App" }, { readFile }), ["md-rocket"]);
  assert.deepEqual(shortcodesAdded("write", { path: "old.md", content: "- :nf-md-check: done\n- more\n" }, { readFile }), []);
  assert.deepEqual(shortcodesAdded("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "log(':nf-md-check: ok')" }] }), ["md-check"]);
  assert.deepEqual(shortcodesAdded("edit", { path: "old.md", edits: [{ oldText: "- :nf-md-check: done", newText: "- :nf-md-check: done!" }] }), []);
  assert.deepEqual(shortcodesAdded("edit", { path: "a.md", edits: JSON.stringify([{ oldText: "a", newText: ":nf-dev-rust: b" }]) }), ["dev-rust"]);
});

test("commands and other tools are checked; searches are not", () => {
  assert.deepEqual(shortcodesAdded("bash", { command: "git commit -m \":nf-md-check: Fix\"" }), ["md-check"]);
  assert.deepEqual(shortcodesAdded("bash", { command: "rg ':nf-md-check:' src" }), []);
  assert.deepEqual(shortcodesAdded("grep", { pattern: ":nf-md-check: done" }), []);
  assert.deepEqual(shortcodesAdded("wiki_insights", { insights: [{ text: ":nf-md-check: shipped" }] }), ["md-check"]);
});

test("the guard blocks once with a reason, then lets an identical retry through", () => {
  const dir = mkdtempSync(join(tmpdir(), "icons-"));
  writeFileSync(join(dir, "kept.md"), "- :nf-md-check: done\n");
  const guard = createIconGuard();
  const ctx = { cwd: dir };
  const call = { toolName: "write", input: { path: "notes.md", content: ":nf-md-check: hi" } };
  const blocked = guard(call, ctx);
  assert.equal(blocked?.block, true);
  assert.match(blocked.reason, /:nf-md-check:.*only render in this chat/);
  assert.equal(guard({ ...call, input: { ...call.input } }, ctx), undefined);
  assert.equal(guard(call, ctx)?.block, true, "confirmation is used up");
  assert.equal(guard({ toolName: "write", input: { path: "kept.md", content: "- :nf-md-check: done\n- x\n" } }, ctx), undefined);
});

test("the prompt mentions icons only when the terminal can draw them", () => {
  assert.doesNotMatch(renderingSection({ images: true }), /nf-/);
  const text = renderingSection({ images: true, icons: true });
  assert.match(text, /:nf-md-check_circle:/);
  assert.match(text, /never in files/);
  assert.ok(text.length < 900, `short: ${text.length} chars`);
});

describe("copying", () => {
  const lookup = (name: string) => (name === "md-check" || name === "md-alert" ? "\u{F012C}" : undefined);
  test("drawn icons leave copied Markdown, with their spacing", () => {
    assert.equal(stripIcons(":nf-md-check: passing, :nf-md-alert: flaky", lookup), "passing, flaky");
    assert.equal(stripIcons("Done :nf-md-check:", lookup), "Done");
    assert.equal(stripIcons("a :nf-md-check: b", lookup), "a b");
    assert.equal(stripIcons("| :nf-md-check: ok |", lookup), "| ok |");
  });
  test("unknown names and code stay as written", () => {
    assert.equal(stripIcons("say :nf-md-nope: here", lookup), "say :nf-md-nope: here");
    const text = "Use `:nf-md-check:` like :nf-md-check: this";
    assert.equal(stripIcons(text, lookup, markdownCodeRanges(text)), "Use `:nf-md-check:` like this");
  });
});
