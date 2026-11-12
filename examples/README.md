# Forma examples

## Runnable examples

- [embed-node](./embed-node/README.md): a Node ESM application using the
  experimental `createLanguage` facade, a checked form prelude, and one granted
  capability. No Effect imports are needed in the embedding code.
- [project](./project/README.md): a standalone `.lisp` module graph with a form
  library, data, and CLI checking, evaluation, and formatting checks.
- [http-rpc](./http-rpc/README.md): a repository-based Effect HTTP/RPC exploration
  with generated contracts and explicit native handlers.

`pnpm check:examples` installs the packed `@forma-language/forma` tarball offline
into temporary copies of `embed-node` and `project`, then runs their tests.
CI runs this after `pnpm pack:check`. The public package is not yet published;
see each example for a local tarball installation.

## Source corpus

The Markdown-only domain directories (including `hr`, `staffing`, and
`labor-union`) are reviewable conformance inputs for the descriptor,
elaboration, and artifact pipeline. Lisp programs live in fenced Markdown
blocks so each example can explain its intent beside its source. They are not
standalone applications. They feed the reviewed corpus golden; keep them in place.

These unrelated domains demonstrate prelude-defined vocabulary rather than
concepts built into the TypeScript engine.
