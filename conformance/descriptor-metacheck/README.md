# Descriptor definition validation

`cases.json` includes the malformed extensions and surface unknown-slot cases from
`packages/ocaml/scripts/descriptor-preludes.mjs`, plus hook clause, meta-kind,
constructed-by, unresolved hook, extension clause, and unknown-slot cases for
that script's non-artifact validation contract. The unresolved hook case keeps
the original hook name while omitting artifact payload clauses.

The TypeScript plain function `checkDescriptors` returns located diagnostics.
Artifact payload contracts, validator names, and artifact summary requirements
are supplied through its `checkForm` extension callback. They remain owned by
the artifact workspace. Prelude/session loading decides when to call the stage
and whether reference checking should wait until dependencies are registered.
