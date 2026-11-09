# pi-rich-markdown

Terminal-native Markdown for [pi](https://github.com/earendil-works/pi).
Answers render with their structure, not their syntax:

- **Tables** without boxes: a bold header, a thin rule under each column,
  cells that wrap inside their column without splitting words, numbers
  aligned right. Terminals too narrow for columns get one card per row.
- **Code blocks** as a tinted panel with pi's syntax highlighting, a quiet
  language label and no ``` fences. Long lines wrap with a `↪` mark and
  keep every character.
- **Headings** without `#` markers; levels 1 and 2 get a rule underneath.
- **Callouts**: GitHub's `> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING` and
  `CAUTION` get a coloured bar and title.
- **Lists** with round bullets and check boxes for task items.
- **Mermaid diagrams** and **display math** (`$$ … $$`) drawn as images on
  terminals with Kitty graphics (Kitty, Ghostty, Rex, WezTerm), coloured
  from your pi theme. Elsewhere they stay text. Diagram text uses your
  terminal's font when it can be found (Rex, or `PI_RICH_MARKDOWN_FONT`
  naming an installed font), and the bundled Maple Mono otherwise, so
  diagrams have text over SSH and on machines without fonts.
- **Nerd Font icons**: the model can write `:nf-md-check_circle:` and you
  see the icon. See [Icons](#icons).

Run `/md-preview` to see a sample document. It is added to the transcript
only and never sent to the model.

## Install

```sh
pi install git:github.com/goulinkh/pi-rich-markdown
```

For Mermaid images, turn off pi's built-in Unicode diagrams. Otherwise pi
replaces Mermaid blocks before this extension sees them:

```json
{ "markdown": { "mermaid": "off" } }
```

## Icons

On terminals that can draw [Nerd Font](https://www.nerdfonts.com/cheat-sheet)
glyphs, the model is told it may use icons, written as shortcodes with the
official cheat-sheet names: `:nf-md-check_circle:`, `:nf-dev-rust:`,
`:nf-oct-git_branch:`.

- **Display only.** The message keeps the shortcode; only the terminal shows
  the glyph. The session, the model's context and other terminals see
  readable text. Code spans, code blocks and `\:nf-…:` stay literal.
- **Never in files.** The model is told to use icons in chat replies only,
  and a tool call that would add shortcodes to a file, command, commit
  message or any other tool input is blocked with a reason. Existing
  shortcodes in a file may stay, and quoted mentions (`` `:nf-md-check:` ``,
  or inside Markdown code) are allowed. To write the literal text anyway,
  the model repeats the blocked call unchanged.
- **Only real glyphs.** Unknown names, and icons newer than your font, stay
  as text instead of an empty box.
- **Outlined by default.** When an icon set has an outlined variant, it is
  drawn instead of the filled one: Material Design `_outline`, Font Awesome
  `_o`, and Octicons without `_fill`. Set `PI_RICH_MARKDOWN_ICON_STYLE` to
  `filled` for the opposite, or `as-written` to draw exactly what the model
  wrote.

Icons are on for Rex, Ghostty, Kitty and WezTerm (they bundle a Nerd Font
fallback) and for any terminal font whose name contains "Nerd" or "NF".
`PI_RICH_MARKDOWN_ICONS=1` or `0` overrides the detection. The name table
is Nerd Fonts 3.5.1; `node scripts/update-icons.mjs` refreshes it.

## Copying as Markdown

In fullscreen mode (`tuiMode: "fullscreen"`, pi's default), pi owns mouse
selection and copies the text it drew: a table as aligned columns, a code
panel with its padding, a diagram or formula as blank lines. This extension
copies the Markdown behind the selection instead:

- A selection across several blocks copies their source: `**bold**`,
  `| tables |`, fenced code, ```` ```mermaid ```` diagrams, `$$` math,
  `> [!TIP]` callouts.
- One whole block copies its source.
- Lines inside a code panel copy as the code itself, unwrapped and without
  the fence, ready to paste into a shell.
- Part of a table, diagram or formula copies the whole block.
- Part of a paragraph (a double-clicked word) copies as pi copies it.
- Tool output and other text outside Markdown copies as before.
- Icons stay on screen: drawn `:nf-…:` shortcodes are left out of the copy.

`PI_RICH_MARKDOWN_COPY=0` turns this off. In regular mode the terminal
does the selecting and only knows the characters on screen; use `/copy` or
`Ctrl+X` there for the last answer's Markdown.

## Image memory

Terminals keep every image decoded in memory for as long as it is on screen
or in the scrollback, and pi never deletes the images it sends. A long
session with screenshots can reach hundreds of megabytes; Rex freezes a pane
once it passes 64 MiB.

This extension routes every image through one store, pi's own included
(`read` on a PNG, pasted screenshots):

- Images are drawn at the pixel size of the cells they cover, not their
  full resolution.
- Opaque images are sent as compressed raw RGB instead of PNG: three bytes
  per pixel in the terminal instead of four.
- Redraws and resizes replace an image instead of adding another one.
- The total stays under a budget. When a new image would go over, the
  oldest images are deleted and turn blank in the scrollback.

In fullscreen mode every image is also registered with pi, so pi keeps it
inside the transcript: cropped where the transcript ends instead of drawn
over the editor, and re-placed rather than re-sent on each repaint.

| Environment variable | Default | Meaning |
|---|---:|---|
| `PI_RICH_MARKDOWN_IMAGE_BUDGET_MB` | 32 | Total decoded image memory |
| `PI_RICH_MARKDOWN_IMAGE_MAX_MB` | 16 | Largest single image; bigger ones are drawn at a lower resolution |
| `PI_RICH_MARKDOWN_IMAGE_DENSITY` | 1 | Pixels per reported cell pixel |

## How it works

pi has no API for replacing its Markdown renderer; its Markdown transformer
hook can only rewrite the text before pi draws it. Extensions share pi's
`@earendil-works/pi-tui` module, so this extension replaces
`Markdown.prototype.renderToken`, `Markdown.prototype.renderInlineTokens`
(icons), `Image.prototype.render` and
`TuiAltScreen.prototype.getActiveSelectionText` (copying) directly.
That reaches every Markdown surface: assistant and user messages, thinking,
summaries.

Each block renderer falls back to pi's own rendering when it cannot draw a
block, and the extension keeps pi's renderer entirely if the methods it
needs are missing. It relies on pi internals and is tested against pi
1.5.0; a pi update can change them.

## Licenses

The code is MIT. The bundled Maple Mono fonts in `src/fonts` are © The
Maple Mono Project Authors under the SIL Open Font License 1.1
(`src/fonts/OFL.txt`).

## Development

```sh
npm install
npm test                 # runs against the globally installed pi
npm run preview -- 100   # print the preview document at 100 columns
pi -e ./src/index.ts     # try the working copy without installing it
```
