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
| Rust dependency `russh`, `russh-cryptovec`, `russh-util`, `pageant` (SSH client, milestone 4) | russh | Warp Technologies and contributors | crates.io, built with `ring`, not `aws-lc-rs` | Apache-2.0 |
| Rust dependency `crypto_box`, `crypto_secretbox`, `salsa20`, `poly1305` (relay channel, milestone 4) | RustCrypto NaCl compatibility crates | RustCrypto developers | crates.io | Apache-2.0 OR MIT |
| Rust dependencies of `russh`: `ssh-key`, `ssh-cipher`, `ssh-encoding`, `rsa`, `ecdsa`, `p256`, `p384`, `p521`, `ed25519`, `ml-kem`, `aes-gcm`, `scrypt`, `pbkdf2`, `argon2`, `blake2`, `sha3` and the RustCrypto traits and formats crates under them (`aead`, `cipher`, `der`, `pkcs1`, `pkcs5`, `pkcs8`, `spki`, `sec1`, `signature`, `elliptic-curve`, and others) | RustCrypto | RustCrypto developers | crates.io | Apache-2.0 OR MIT |
| Rust dependencies `curve25519-dalek`, `ed25519-dalek` | dalek-cryptography | Isis Lovecruft, Henry de Valence and contributors | crates.io | BSD-3-Clause |
| Rust dependency `fiat-crypto` | Fiat Cryptography | MIT PLV | crates.io | MIT OR Apache-2.0 OR BSD-1-Clause |
| Rust dependency `ssh2-config`, `wildmatch` (`~/.ssh/config`, milestone 4) | ssh2-config, wildmatch | Christian Visintin, Ben Gerber | crates.io | MIT |
| Rust dependency `sys-locale` (the system's preferred language, anonymous usage data) | sys-locale | 1Password and contributors | crates.io | MIT OR Apache-2.0 |
| Rust dependencies `futures`, `nix`, `num-bigint`, `md5`, `delegate`, `enum_dispatch`, `cfg_aliases` (through `russh` and `ssh2-config`) | | Their authors | crates.io | MIT OR Apache-2.0, MIT, or Apache-2.0 OR MIT |
| Rust dependencies `tauri-plugin-updater`, `minisign-verify`, `zip`, `tar`, `osakit`, `objc2-osa-kit` (self-update, milestone 5; TLS through `ring`, not `aws-lc-rs`) | Tauri updater plug-in and the readers of update files and signatures | Tauri contributors, and the crates' own authors | crates.io | Apache-2.0 OR MIT; MIT (`minisign-verify`, `zip`); Zlib OR Apache-2.0 OR MIT (`objc2-osa-kit`) |
| Rust dependencies `hyper-rustls`, `constant_time_eq`, `filetime`, `xattr`, `typed-path`, `zeroize_derive`, `core-foundation` 0.9, `system-configuration`, `system-configuration-sys`, `windows-registry` (through the updater's HTTP client and archive readers) | | Their authors | crates.io | Apache-2.0 OR ISC OR MIT, CC0-1.0 OR MIT-0 OR Apache-2.0, or MIT OR Apache-2.0 |

The rows marked "built frontend" come with the workbench (`@av-pi-studio/workbench`), which the
app bundles; the browser client ships the same files. The workbench and `@av-pi-studio/ui-library`
are themselves AGPL-3.0, which is also not on the list above: the app's licence is undecided.

Replace the placeholder icon before release: `npm run tauri icon <your-1024px.png>` in
`apps/pistudiodesktop` regenerates every size.
