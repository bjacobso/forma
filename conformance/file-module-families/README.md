# Descriptor families in file modules

`packages/ts/test/file-module-families.test.ts` loads these neutral inputs:

- `qualified.lisp`: slash-qualified helpers, forms, exports and namespace access.
- `references.lisp`: forward semantic references through optional lists and a
  record alias, including an ordinary computed field that still needs checking.
- `nested.lisp`: private nested families with definition-site checks, helpers and
  constants; ordinary child value holes use the caller's environment.
- `helper-predicates.lisp`: polymorphic `nil?` inputs, checked and executed by
  `builtin-contracts.test.ts`.
- `collision.lisp`: duplicate qualified child/value declarations retain the
  existing duplicate-declaration diagnostic.

The tests also pin the pre-change computed-child boundary. A single prebuilt
IR map or symbol naming it worked; call expressions and repeated computed
entries failed. These tests retain both outcomes.

RFC 0030 acceptance is incomplete: the separate restored connectors tests
now reach `some`, whose runtime returns a callback result or nil. A Bool
scheme would be unsound; nullable results cannot be used by the unchanged
library’s Bool-only conditions.
No stored expected output was rewritten.
