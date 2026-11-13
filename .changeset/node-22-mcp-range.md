---
"@forma-language/forma": patch
---

Support Node.js 22.19 or later; the package previously declared `>=24` but uses no Node 24 API. CI now runs the engine, host, packaging, tarball and example checks on Node 22.19 too. Widen the optional `@modelcontextprotocol/sdk` peer from exactly `1.32.2` to `^1.32.2`, so consumers on a later 1.x patch or minor resolve it.
