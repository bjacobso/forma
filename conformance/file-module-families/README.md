# Descriptor families in file modules

`packages/ts/test/file-module-families.test.ts` loads these neutral inputs:

- `qualified.lisp`: slash-qualified helpers, forms, exports and namespace access.
- `references.lisp`: forward semantic references through optional lists and a
  record alias, including an ordinary computed field that still needs checking.
- `nested.lisp`: private nested families with definition-site checks, helpers and
  constants; ordinary child value holes use the caller's environment.
- `collision.lisp`: duplicate qualified child/value declarations retain the
  existing duplicate-declaration diagnostic.
