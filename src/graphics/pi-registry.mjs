// Tell pi-tui about the images this extension draws.
//
// In fullscreen mode pi paints the transcript inside a scroll view and keeps
// images within it: an image line is cropped (y=, h=, r=) where the view ends,
// so it cannot cover the editor or footer below, and its top is re-placed when
// it scrolls past the top edge. Repaints send a placement (a=p) instead of the
// image data once the terminal has it. All of that works only for image IDs
// pi has registered; an unregistered line is placed at its full height on
// every frame, over whatever is drawn below it.
//
// pi-tui does not export its registry, but renderImage() registers the ID it
// is given. Calling it with the cell size set to the image's own pixels per
// cell registers exactly the planned box; the sequence it returns is unused.

/** A function that registers {imageId, columns, rows, widthPx, heightPx} with pi, or undefined. */
export function piImageRegistrar(tui) {
  const { renderImage, getCellDimensions, setCellDimensions, getCapabilities } = tui;
  if (![renderImage, getCellDimensions, setCellDimensions, getCapabilities].every((f) => typeof f === "function")) return undefined;
  return ({ imageId, columns, rows, widthPx, heightPx }) => {
    if (getCapabilities().images !== "kitty") return;
    const saved = getCellDimensions();
    try {
      setCellDimensions({ widthPx: widthPx / columns, heightPx: heightPx / rows });
      renderImage("", { widthPx, heightPx }, { imageId, maxWidthCells: columns, maxHeightCells: rows });
    } finally {
      setCellDimensions(saved);
    }
  };
}
