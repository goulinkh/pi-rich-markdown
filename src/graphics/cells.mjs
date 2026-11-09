// Terminal cell size in device pixels, which decides how many pixels an
// image gets per cell.
//
// pi asks the terminal once with CSI 16 t. Rex answers that query with
// placeholder values (8x16) while its own CLI reports the real size (17x37 on
// a Retina Mac), so images sized from the query come out at half resolution
// and are blurry. Inside Rex we ask its CLI instead, at startup and after
// every resize (a font size change resizes the grid too).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Returns a function giving the current cell size: Rex's when running inside
 * Rex and its CLI answers, pi-tui's otherwise.
 */
export function cellDimensionsSource(tui, { env = process.env, stdout = process.stdout, run = execFileSync } = {}) {
  let rexCell;
  if (env.TERM_PROGRAM === "rex" && env.REX_SESSION && env.REX_BLOCK) {
    const bin = env.REX_BIN_DIR && existsSync(join(env.REX_BIN_DIR, "rex")) ? join(env.REX_BIN_DIR, "rex") : "rex";
    const refresh = () => {
      try {
        const out = run(bin, ["block", "call", "-s", env.REX_SESSION, "-b", env.REX_BLOCK, "size"], {
          encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"],
        });
        const { cell_width_px: widthPx, cell_height_px: heightPx } = JSON.parse(out);
        rexCell = widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined;
      } catch {
        rexCell = undefined;
      }
    };
    refresh();
    stdout?.on?.("resize", refresh);
  }
  return () => rexCell ?? tui.getCellDimensions();
}
