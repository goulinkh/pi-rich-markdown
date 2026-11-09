// Copying a fullscreen selection as Markdown, with pi's real components.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { selectionAsMarkdown } from "../src/copy/markdown-copy.mjs";
import { installMarkdownRenderer } from "../src/markdown/install.mjs";
import { KittyImageStore, limitsFromEnv } from "../src/graphics/kitty-images.mjs";

const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const themes = await import(pathToFileURL(join(pi, "dist/modes/interactive/theme/theme.js")).href);

const ANSWER = [
  "Here is the **plan** with `code`.",
  "",
  "| Step | Owner |",
  "|---|---|",
  "| Build | ci |",
  "| Ship | me |",
  "",
  "- first item",
  "- second item",
  "",
  "```ts",
  "const x = 1;",
  "let y = 2;",
  "```",
].join("\n");

/** A transcript like pi's: a tool line, an assistant Markdown, another tool line. */
function transcript(width = 60) {
  const root = new tui.Container();
  root.addChild(new tui.Text("$ npm test  (tool output)", 1, 0));
  const md = new tui.Markdown(ANSWER, 1, 0, themes.getMarkdownTheme());
  root.addChild(md);
  root.addChild(new tui.Text("done in 3s", 1, 0));
  const lines = root.render(width);
  // AssistantMessageComponent marks its first and last line with OSC 133 zones.
  const first = lines.findIndex((l: string) => l.includes("plan"));
  lines[first] = "\x1b]133;A\x07" + lines[first];
  const scrollView = {};
  const screen = {
    currentLayout: { root: { children: [{ scrollView, scrollContentLines: lines, children: [{ component: root }] }] } },
    selection: undefined as unknown,
    getSelectionBounds() { return this.selection; },
    getSelectionColumns: tui.TuiAltScreen.prototype.getSelectionColumns,
  };
  const plain = lines.map((l: string) => tui.stripTerminalSequences(l));
  const rowOf = (needle: string) => plain.findIndex((l: string) => l.includes(needle));
  const select = (fromRow: number, fromCol: number, toRow: number, toCol: number) => {
    screen.selection = { start: { row: fromRow, col: fromCol, scrollView }, end: { row: toRow, col: toCol, scrollView } };
    return selectionAsMarkdown(screen, tui);
  };
  return { select, rowOf, plain };
}

describe("copy as Markdown", () => {
  let restore: () => void;
  before(() => {
    themes.initTheme("dark");
    tui.setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const limits = limitsFromEnv({});
    restore = installMarkdownRenderer({ tui, limits, store: new KittyImageStore(limits), getTheme: () => themes.theme });
  });
  after(() => restore());

  test("a selected table copies as a Markdown table", () => {
    const t = transcript();
    const out = t.select(t.rowOf("Build"), 0, t.rowOf("Ship"), 20);
    assert.equal(out, "| Step | Owner |\n|---|---|\n| Build | ci |\n| Ship | me |");
  });

  test("a selection across blocks copies their source, formatting included", () => {
    const t = transcript();
    const out = t.select(t.rowOf("plan"), 3, t.rowOf("second item"), 10);
    assert.ok(out.startsWith("Here is the **plan** with `code`.\n\n| Step | Owner |"), out);
    assert.ok(out.endsWith("- first item\n- second item"), out);
  });

  test("a whole code panel, edges included, copies as a fenced block", () => {
    const t = transcript();
    assert.equal(t.select(t.rowOf("const x") - 2, 0, t.rowOf("let y") + 1, 60), "```ts\nconst x = 1;\nlet y = 2;\n```");
  });

  test("all the lines of a code panel copy as bare code, ready to paste", () => {
    const t = transcript();
    assert.equal(t.select(t.rowOf("const x"), 0, t.rowOf("let y"), 60), "const x = 1;\nlet y = 2;");
  });

  test("lines inside a code panel copy as their source lines", () => {
    const t = transcript();
    assert.equal(t.select(t.rowOf("let y"), 0, t.rowOf("let y"), 8), "let y = 2;");
  });

  test("part of a paragraph copies as pi copies it", () => {
    const t = transcript();
    const row = t.rowOf("plan");
    const col = t.plain[row].indexOf("plan");
    assert.equal(t.select(row, col, row, col + 4), undefined);
  });

  test("a whole paragraph copies with its formatting", () => {
    const t = transcript();
    assert.equal(t.select(t.rowOf("plan"), 0, t.rowOf("plan"), 60), "Here is the **plan** with `code`.");
  });

  test("part of a table copies the whole table", () => {
    const t = transcript();
    assert.equal(t.select(t.rowOf("Build"), 3, t.rowOf("Build"), 6), "| Step | Owner |\n|---|---|\n| Build | ci |\n| Ship | me |");
  });

  test("rows outside Markdown copy as plain text around the source", () => {
    const t = transcript();
    const out = t.select(t.rowOf("npm test"), 0, t.rowOf("done in"), 40);
    // Plain rows copy as pi copies them, padding included.
    assert.ok(out.startsWith(" $ npm test  (tool output)\n\nHere is the **plan**"), out);
    assert.ok(out.endsWith("```\n\n done in 3s"), out);
  });

  test("without a scroll-view selection pi's text is kept", () => {
    const t = transcript();
    assert.equal(selectionAsMarkdown({ getSelectionBounds: () => ({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }) }, tui), undefined);
    assert.ok(t.plain.length > 5);
  });
});
