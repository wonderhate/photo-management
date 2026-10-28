# Browser RAW notices

The browser distribution includes the unmodified `dist/index.js`, `dist/worker.js`,
`dist/libraw.js` and `dist/libraw.wasm` from npm `libraw-wasm@1.6.0`.

- Wrapper: https://github.com/ybouane/LibRaw-Wasm/tree/v1.6.0 — author ybouane;
  upstream package.json declares ISC. The npm tarball does not include a LICENSE
  file. See `wrapper-ISC.txt` for the standard ISC terms and upstream declaration.
- LibRaw: https://github.com/LibRaw/LibRaw/tree/0.22.1 — dual LGPL 2.1 / CDDL 1.0.
  Copyright and both license texts accompany this distribution. Its source is
  available at that tag, including the notices for incorporated dcraw code.
- Little CMS: https://github.com/mm2/Little-CMS/tree/lcms2.19.1 — MIT.
- Emscripten: https://github.com/emscripten-core/emscripten — MIT / University of
  Illinois-NCSA; its system ports include libpng, zlib and libjpeg. Corresponding
  notices are included. The wrapper's published build does not identify each
  Emscripten port revision; the included port notices are sourced from libpng
  v1.6.50, zlib v1.3.1 and libjpeg-turbo 3.1.0, not asserted as binary version IDs.

Wrapper source and rebuild instructions:
https://github.com/ybouane/LibRaw-Wasm/blob/v1.6.0/compileLibraw.sh
This script identifies LibRaw 0.22.1 and Little CMS 2.19.1 and enables JPEG,
PNG, zlib, LCMS and pthreads. This project does not modify these compiled libraries.

The photography reference site's images and code are not included. Public RAW
validation samples are downloaded separately into the ignored `.test-artifacts`
directory and are not distributed with the application.
