# Descriptor definition validation

`cases.json` includes malformed extensions and surface unknown-slot cases, plus
hook clause, meta-kind, constructed-by, unresolved hook, extension clause, and
unknown-slot cases for the non-artifact validation contract. The cases were
first collected from the retired OCaml engine's descriptor prelude gate. The
unresolved hook case keeps the original hook name while omitting artifact
payload clauses.

The TypeScript plain function `checkDescriptors` returns located diagnostics.
Artifact payload contracts, validator names, and artifact summary requirements
are supplied through its `checkForm` extension callback. They remain owned by
the artifact workspace. Prelude/session loading decides when to call the stage
and whether reference checking should wait until dependencies are registered.

`packages/ts/test/check-descriptors.test.ts` and
`packages/host/test/prelude-metacheck.test.ts` check every case.
