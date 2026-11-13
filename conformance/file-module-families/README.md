# Descriptor families in file modules

`packages/ts/test/file-module-families.test.ts` loads these neutral inputs:

- `qualified.lisp`: slash-qualified helpers, forms, exports and namespace access.
- `references.lisp`: forward semantic references through optional lists and a
  record alias, including an ordinary computed field that still needs checking.
- `nested.lisp`: private nested families with definition-site checks, helpers and
  constants; ordinary child value holes use the caller's environment.
- `collision.lisp`: duplicate qualified child/value declarations retain the
  existing duplicate-declaration diagnostic.

The tests also pin the pre-change computed-child boundary. A single prebuilt
IR map or symbol naming it worked; call expressions and repeated computed
entries failed. These tests retain both outcomes.

RFC 0030 acceptance is incomplete: the separate restored connectors tests
currently expose missing HM schemes in its unchanged runtime helper library.
No stored expected output was rewritten.
