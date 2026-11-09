import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { limitsFromEnv, sharedImageStore } from "./graphics/kitty-images.mjs";
import { installImageBudget } from "./graphics/pi-images.mjs";
import { cellDimensionsSource } from "./graphics/cells.mjs";
import { installMarkdownRenderer } from "./markdown/install.mjs";
import { renderingSection } from "./prompt.mjs";

const PREVIEW = "rich-markdown-preview";
const CELLS = Symbol.for("pi-rich-markdown.cell-dimensions");

/**
 * pi-rich-markdown: terminal-native Markdown for pi.
 *
 * - Replaces how pi draws Markdown blocks (tables, code, headings, quotes,
 *   callouts, lists, Mermaid, display math), falling back to pi's renderer
 *   whenever a block cannot be drawn.
 * - Routes every image, pi's and ours, through one store that keeps decoded
 *   image memory under budget (Rex freezes a pane past 64 MiB).
 */
export default function richMarkdown(pi: ExtensionAPI) {
  const limits = limitsFromEnv();
  const store = sharedImageStore({ budgetBytes: limits.budgetBytes, maxImageBytes: limits.maxImageBytes });
  // One source per process: /reload must not add another resize listener.
  const shared = globalThis as { [CELLS]?: () => { widthPx: number; heightPx: number } };
  const getCellDimensions = (shared[CELLS] ??= cellDimensionsSource(tui));
  installImageBudget({ tui, store, limits, getCellDimensions });

  let ui: ExtensionUIContext | undefined;
  let warned = false;
  try {
    installMarkdownRenderer({
      tui,
      store,
      limits,
      getCellDimensions,
      getTheme: () => ui?.theme,
      onError: (error: unknown) => {
        if (warned) return;
        warned = true;
        ui?.notify(`rich-markdown: a block fell back to pi's renderer (${String(error)})`, "warning");
      },
    });
  } catch (error) {
    pi.on("session_start", (_event, ctx) => ctx.ui.notify(String(error), "warning"));
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") ui = ctx.ui;
  });

  // Only the interactive TUI renders any of this; print/JSON/RPC output does not.
  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    event.systemPromptOptions.sections.rendering = renderingSection({ images: tui.getCapabilities().images === "kitty" });
  });

  pi.registerEntryRenderer(PREVIEW, (entry) => {
    const text = typeof entry.data === "string" ? entry.data : "";
    return new tui.Markdown(text, 1, 1, getMarkdownTheme());
  });

  pi.registerCommand("md-preview", {
    description: "Show a sample document rendered by rich-markdown (not sent to the model)",
    handler: async () => {
      pi.appendEntry(PREVIEW, readFileSync(new URL("./preview.md", import.meta.url), "utf8"));
    },
  });
}
