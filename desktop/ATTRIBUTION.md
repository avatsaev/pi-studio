# Attribution

Every bundled third-party asset (font, icon, image, sound, data file) gets one row here, in the
change that adds it. Assets and dependencies, Rust crates and npm packages alike, must be under a
permissive licence: `ISC`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `OFL-1.1`,
`CC0-1.0`, `CC-BY-4.0` or similar.

| Path | Title | Author | Source | Licence |
|---|---|---|---|---|
| `apps/pistudiodesktop/src-tauri/icons/` | Placeholder application icon (a check mark on a rounded square) | The project template | Generated for the template | CC0-1.0 |
| built frontend, `assets/CascadiaMono*.woff2` | Cascadia Mono and Cascadia Mono NF (the terminal font) | Microsoft Corporation | Bundled by the workbench: `packages/workbench/src/fonts/` (licence text beside the files) | OFL-1.1 |
| built frontend, `assets/KaTeX_*` | KaTeX fonts (math in messages) | Khan Academy and contributors | npm `katex`, through the workbench | MIT |
| built frontend, `pdfjs/cmaps/` | Adobe CMap resources | Adobe Systems | npm `pdfjs-dist`, copied by the workbench's Vite plugin with its `LICENSE` | BSD-3-Clause |
| built frontend, `pdfjs/standard_fonts/Foxit*` | Foxit fonts (the PDF standard 14) | PDFium Authors | npm `pdfjs-dist`, with `LICENSE_FOXIT` | BSD-3-Clause |
| built frontend, `pdfjs/standard_fonts/LiberationSans*` | Liberation Sans | Red Hat | npm `pdfjs-dist`, with `LICENSE_LIBERATION` | GPL-2.0 with the Liberation font exception: **not on the list above; unresolved** |
| built frontend, `pdfjs/iccs/` | CGATS001 compatible colour profile | See its `LICENSE` | npm `pdfjs-dist` | CC0-1.0 |
| built frontend, `pdfjs/wasm/` | OpenJPEG, JBIG2 (PDFium) and qcms decoders | Their authors; see the `LICENSE_*` files beside them | npm `pdfjs-dist` | BSD-2-Clause, BSD-3-Clause, MIT |

The rows marked "built frontend" come with the workbench (`@av-pi-studio/workbench`), which the
app bundles; the browser client ships the same files. The workbench and `@av-pi-studio/ui-library`
are themselves AGPL-3.0, which is also not on the list above: the app's licence is undecided.

Replace the placeholder icon before release: `npm run tauri icon <your-1024px.png>` in
`apps/pistudiodesktop` regenerates every size.
