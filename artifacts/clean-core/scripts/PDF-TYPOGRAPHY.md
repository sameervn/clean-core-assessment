# PDF typography regressions

Run `pnpm --filter @workspace/clean-core test:pdf`. Requires `pdftotext`
and `pdftoppm` (Poppler 26.06 for the raster fingerprints). Generated PDFs,
PNGs and extracted text are written to `generated-artifacts/pdf-typography/`.
No saved workspace is read or changed.

The fixture covers Arabic, Hebrew, Devanagari, Bengali, Gujarati, Gurmukhi,
Tamil, Telugu, Kannada, Malayalam and Odia. It checks logical ActualText,
Poppler extraction, shaping/mark placement, identifiers, wrapping, and raster
fingerprints of the specimen page and a wrapped mixed-direction paragraph.
The existing Unicode test also checks multi-page content and margins.

Inspect both PNGs when intentionally changing fonts or the renderer. Never
update the hashes merely to make a failed test pass. Raster fingerprints may
change when upgrading Poppler/FreeType; review the images before updating them.

Poppler's plain-text output reverses RTL runs and inserts directional controls
for display. This is not the PDF's logical storage order. Tests separately
decode ActualText to ensure that the original logical strings remain present.
Some PDF readers handle ActualText differently; selection/copy behavior is
reader-dependent.

The optional PyMuPDF second-engine inspection script was removed because its
AGPL license does not meet the client's policy. Use the Poppler PNGs and
ActualText checks above; application PDF evidence uses PDF.js and exports use
pdf-lib, neither of which depended on that inspection script.

All font assets and HarfBuzz are lazy-loaded by the PDF export. HarfBuzz must
remain excluded from Vite dependency optimization, otherwise its relative WASM
URL points into the prebundle directory instead of the actual package.
