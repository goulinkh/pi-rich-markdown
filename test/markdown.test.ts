// Renders Markdown with pi's real Markdown component and theme (from the installed pi).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { KittyImageStore, limitsFromEnv } from "../src/graphics/kitty-images.mjs";
import { installMarkdownRenderer } from "../src/markdown/install.mjs";
import { fitColumns } from "../src/markdown/table.mjs";
import { hardWrap } from "../src/markdown/style.mjs";

const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const themes = await import(pathToFileURL(join(pi, "dist/modes/interactive/theme/theme.js")).href);

let themeOn = true;
const errors: unknown[] = [];
let restore: () => void;

before(() => {
  themes.initTheme("dark");
  tui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  tui.setCellDimensions({ widthPx: 17, heightPx: 37 });
  const limits = limitsFromEnv({});
  restore = installMarkdownRenderer({
    tui, limits, store: new KittyImageStore(limits),
    getTheme: () => (themeOn ? themes.theme : undefined),
    onError: (e: unknown) => errors.push(e),
  });
});
after(() => restore());

const render = (text: string, width = 80) => new tui.Markdown(text, 0, 0, themes.getMarkdownTheme()).render(width);
const plain = (lines: string[]) => lines.map((l) => tui.stripTerminalSequences(l).trimEnd());
const isImage = (l: string) => l.includes("\x1b_G");

test("tables have no box borders, a header rule and aligned columns", () => {
  const out = plain(render("| Name | Size |\n|---|---|\n| alpha | 10 |\n| beta | 200 |"));
  assert.ok(!out.some((l) => /[│┌┐└┘├┤┬┴┼]/.test(l)));
  assert.deepEqual(out.slice(0, 4), ["Name    Size", "─────   ────", "alpha     10", "beta     200"]);
});

test("table cells wrap inside their column without splitting words", () => {
  const md = "| Setting | Meaning |\n|---|---|\n| `budget` | Total decoded image memory shared by every image in the session |";
  const out = render(md, 40);
  for (const l of out) assert.ok(tui.visibleWidth(l) <= 40);
  const text = plain(out).join("\n");
  assert.match(text, /memory/);
  assert.doesNotMatch(text, /memor\n/);
});

test("very narrow tables become one card per row", () => {
  const md = "| A | B | C | D | E |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |";
  const out = plain(render(md, 20));
  assert.ok(out.some((l) => /^A\s+1$/.test(l)));
});

test("column fitting keeps whole words before sharing the rest", () => {
  assert.deepEqual(fitColumns([20, 10, 40], 50, [20, 5, 9]), [20, 10, 20]);
  assert.deepEqual(fitColumns([10, 10], 30), [10, 10]);
});

test("code blocks are a panel without fences, every line exactly the width", () => {
  const out = render("```ts\nconst answer = 42;\n```", 50);
  assert.ok(!plain(out).some((l) => l.includes("```")));
  assert.match(plain(out)[1], /^ ts/);
  for (const l of out.filter(Boolean)) assert.equal(tui.visibleWidth(l), 50);
});

test("long code lines wrap without losing characters", () => {
  const code = "rex split -s session --label image-demo --json -- node /tmp/kitty-demo.mjs";
  const out = plain(render("```\n" + code + "\n```", 30)).slice(1, -1);
  const joined = out.map((l, i) => (i === 0 ? l.slice(1) : l.slice(3))).join("").trimEnd();
  assert.equal(joined.replace(/\s+$/, ""), code);
});

test("hardWrap carries styles into each chunk", () => {
  const chunks = hardWrap("\x1b[31mabcdef\x1b[0m", 4, tui.visibleWidth);
  assert.deepEqual(chunks.map((c) => tui.stripTerminalSequences(c)), ["abcd", "ef"]);
  assert.ok(chunks[1].startsWith("\x1b[31m"));
});

test("headings drop the # markers; H1 and H2 get rules", () => {
  const out = plain(render("# Title\n\n## Section\n\n### Detail\n\ntext"));
  assert.ok(!out.some((l) => l.startsWith("#")));
  assert.deepEqual(out.slice(0, 2), ["Title", "━━━━━"]);
  assert.ok(out.includes("Section") && out.includes("───────") && out.includes("Detail"));
});

test("GitHub callouts get a title and lose their marker", () => {
  const out = plain(render("> [!WARNING]\n> Mind the **budget**."));
  assert.deepEqual(out.slice(0, 2), ["▎ ! Warning", "▎ Mind the budget."]);
});

test("lists use round bullets and check boxes", () => {
  const out = plain(render("- one\n  - nested\n- [x] done\n- [ ] todo"));
  assert.deepEqual(out.slice(0, 4), ["• one", "    ◦ nested", "✔ done", "☐ todo"]);
});

test("a closed Mermaid block is an image on its first line, then blank rows for its height", () => {
  const out = render("```mermaid\ngraph LR\n  A --> B\n```\n\nafter", 80);
  const at = out.findIndex(isImage);
  assert.ok(at >= 0);
  const rows = Number(/,r=(\d+)/.exec(out[at])![1]);
  assert.doesNotMatch(out[at], /\x1b\[\d+[AB]/, "no cursor movement: pi's renderer keeps its own row count");
  assert.match(out[at], /C=1/);
  for (const l of out.slice(at + 1, at + rows)) assert.equal(l.trim(), "");
  assert.ok(plain(out).slice(at + rows).some((l) => l === "after"));
});

test("a Mermaid block still streaming stays a code panel", () => {
  const out = render("```mermaid\ngraph LR\n  A --> B", 80);
  assert.ok(!out.some(isImage));
  assert.ok(plain(out).some((l) => l.includes("A --> B")));
});

test("display math becomes an image; inline math stays text", () => {
  const out = render("$$\n\\frac{a}{b}\n$$\n\nand $x^2$ inline", 80);
  assert.ok(out.some(isImage));
  assert.ok(plain(out).some((l) => l.includes("x²")));
});

test("terminals without Kitty graphics keep text diagrams and math", () => {
  tui.setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  try {
    const out = render("```mermaid\ngraph LR\n  A --> B\n```\n\n$$\n\\frac{a}{b}\n$$", 80);
    assert.ok(!out.some(isImage));
  } finally {
    tui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  }
});

test("before the session has a theme, pi renders as usual", () => {
  themeOn = false;
  try {
    const out = plain(render("| a | b |\n|---|---|\n| 1 | 2 |"));
    assert.ok(out[0].startsWith("┌"));
  } finally {
    themeOn = true;
  }
});

test("the preview document renders within the width at any size", () => {
  const doc = readFileSync(new URL("../src/preview.md", import.meta.url), "utf8");
  for (const width of [120, 80, 50, 30]) {
    const out = render(doc, width);
    const tooWide = out.filter((l) => !isImage(l) && tui.visibleWidth(l) > width);
    assert.equal(tooWide.length, 0, `${width} columns: ${tooWide[0]}`);
  }
  assert.deepEqual(errors, []);
});
