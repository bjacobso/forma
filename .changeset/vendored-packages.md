---
"@forma-language/forma": minor
---

Replace npm-based Forma package discovery with offline `forma.json` manifests,
`forma.lock` verification, and committed `vendor/<name>` sources or relative
packages. Check the full dependency closure and report stale manifests, identity
mismatches, and missing, extra, or edited package files before compiling.
