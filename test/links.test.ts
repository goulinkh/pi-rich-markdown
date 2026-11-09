// Plain URLs become hyperlinks, so every row of a wrapped URL opens the whole URL.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { linkify, trimUrl, installTextLinks, installCodeSpanLinks } from "../src/links/linkify.mjs";
import { installMarkdownRenderer } from "../src/markdown/install.mjs";
import { KittyImageStore, limitsFromEnv } from "../src/graphics/kitty-images.mjs";

const pi = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const tui = await import(pathToFileURL(join(pi, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const themes = await import(pathToFileURL(join(pi, "dist/modes/interactive/theme/theme.js")).href);

const URL = "https://github.com/earendil-works/pi-coding-agent/blob/main/packages/coding-agent/docs/extensions.md#registering";

/** For each rendered row: the links opened from the columns of the pieces of `url` it shows. */
function rowsOf(lines: string[], url: string) {
  return lines.map((line) => {
    const plain = tui.stripTerminalSequences(line);
    const cols: (string | undefined)[] = [];
    for (const m of plain.matchAll(/\S+/g)) {
      if (m[0].length < 4 || !url.includes(m[0])) continue;
      for (let c = m.index!; c < m.index! + m[0].length; c++) cols.push(tui.getOsc8LinkAtColumn(line, c));
    }
    return cols;
  });
}
const allOpen = (lines: string[], url: string, _fromRow = 0) => {
  const rows = rowsOf(lines, url).filter((r) => r.length);
  return rows.length > 1 && rows.every((r) => r.every((u) => u === url));
};

describe("linkify", () => {
  test("wraps plain URLs, keeping the styling around them", () => {
    const styled = `\x1b[2mgo to ${URL}.\x1b[22m`;
    assert.equal(linkify(styled), `\x1b[2mgo to \x1b]8;;${URL}\x1b\\${URL}\x1b]8;;\x1b\\.\x1b[22m`);
  });
  test("a URL split by highlighting colours is one link", () => {
    const out = linkify(`curl \x1b[32mhttps://example.com/\x1b[33mpath\x1b[0m done`);
    assert.equal(tui.getOsc8LinkAtColumn(out, 6), "https://example.com/path");
    assert.equal(tui.getOsc8LinkAtColumn(out, 28), "https://example.com/path");
    assert.equal(tui.getOsc8LinkAtColumn(out, 30), undefined);
  });
  test("existing hyperlinks and image lines are left alone", () => {
    const linked = `\x1b]8;;https://a.example\x1b\\https://b.example/text\x1b]8;;\x1b\\`;
    assert.equal(linkify(linked), linked);
    const image = "\x1b_Ga=T,i=1;https://not.a/link\x1b\\";
    assert.equal(linkify(image), image);
  });
  test("sentence punctuation is not part of the URL", () => {
    assert.equal(trimUrl("https://a.example/x)."), "https://a.example/x");
    assert.equal(trimUrl("https://en.wikipedia.org/wiki/Foo_(bar))"), "https://en.wikipedia.org/wiki/Foo_(bar)");
    assert.equal(trimUrl("https://a.example/x?y=1,"), "https://a.example/x?y=1");
  });
  test("URLs shortened for display are not linked", () => {
    for (const text of ["https://example.com/very/lo...", "https://example.com/very/lo…"]) assert.equal(linkify(text), text);
  });
  test("text without URLs is returned as is", () => {
    const text = "nothing to see: a://";
    assert.equal(linkify(text), text);
  });
});

describe("rendering", () => {
  const restores: (() => void)[] = [];
  before(() => {
    themes.initTheme("dark");
    tui.setCapabilities({ images: null, trueColor: true, hyperlinks: true });
    const limits = limitsFromEnv({});
    restores.push(
      installMarkdownRenderer({ tui, limits, store: new KittyImageStore(limits), getTheme: () => themes.theme }),
      installTextLinks({ tui }),
      installCodeSpanLinks({ tui }),
    );
  });
  after(() => restores.reverse().forEach((r) => r()));

  test("tool output: a wrapped URL opens whole from every row", () => {
    const text = new tui.Text(`Tool output:\n${URL}`, 1, 0);
    const lines = text.render(40);
    assert.ok(allOpen(lines, URL, 1), JSON.stringify(rowsOf(lines, URL)));
    assert.equal(text.render(40), lines, "Text still reuses its lines");
  });

  test("inline code: a wrapped URL opens whole from every row", () => {
    const md = new tui.Markdown(`Docs: \`${URL}\` here.`, 1, 0, themes.getMarkdownTheme());
    assert.ok(allOpen(md.render(40), URL, 1));
  });

  test("code panel: every row, continuation marks aside, opens the URL", () => {
    const md = new tui.Markdown("```bash\ncurl " + URL + "\n```", 1, 0, themes.getMarkdownTheme());
    const lines = md.render(40);
    assert.ok(allOpen(lines, URL, 2), JSON.stringify(rowsOf(lines, URL)));
    const marks = lines.filter((l: string) => tui.stripTerminalSequences(l).includes("↪"));
    assert.ok(marks.length > 0);
    for (const line of marks) {
      const col = tui.stripTerminalSequences(line).indexOf("↪");
      assert.equal(tui.getOsc8LinkAtColumn(line, col), undefined, "the continuation mark is not part of the link");
      assert.ok(line.lastIndexOf("\x1b]8;;\x1b\\") > line.lastIndexOf("\x1b]8;;h"), "the link is closed before the row ends");
    }
  });

  test("a code span inside a link keeps that link", () => {
    const md = new tui.Markdown("[`https://shown.example/x`](https://target.example/y)", 1, 0, themes.getMarkdownTheme());
    const line = md.render(60).find((l: string) => l.includes("shown"))!;
    const col = tui.stripTerminalSequences(line).indexOf("shown");
    assert.equal(tui.getOsc8LinkAtColumn(line, col), "https://target.example/y");
  });

  test("without hyperlink support nothing changes", () => {
    tui.setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const restore = installTextLinks({ tui, isEnabled: () => tui.getCapabilities().hyperlinks });
    try {
      const lines = new tui.Text(URL, 0, 0).render(40);
      assert.ok(lines.every((l: string) => !l.includes("\x1b]8;")));
    } finally {
      installTextLinks({ tui });
      tui.setCapabilities({ images: null, trueColor: true, hyperlinks: true });
      void restore;
    }
  });
});
