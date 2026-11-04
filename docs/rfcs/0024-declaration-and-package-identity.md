# RFC 0024: Declaration digests, package revisions and derived requirements

| | |
| --- | --- |
| Status | Proposed; not implemented. Follow-up to [RFC 0002](./0002-modules-and-packages.md) stage 3 |
| Created | 2026-11-04 |
| Scope | Canonical JSON, per-declaration digests, provenance outside digests, a package revision, requirements derived from resolved references, committed snapshots and a staleness check |
| Direction | Identity is computed from what a declaration means, never from where it was written; everything else travels beside it |

## Summary

Forma's artifact envelope hashes all of a session's declarations together.
For some declaration kinds, that hash changes when code moves, because spans
are part of the payload. This RFC gives each declaration its own digest
computed without source locations, and gives a package a revision computed
from its declaration digests. It also derives a package's cross-package
requirements from resolved references, and defines a committed snapshot
format with a check that it is up to date.

These are the pieces of RFC 0002 stage 3 ("manifests, lockfiles, package
resolution") that both consumers built for themselves. The package revision
is what a lockfile pins and what a host deploys.

## Motivation

onb-next commits each package's IR as a snapshot directory
(`packages/ir/src/package.ts`, `packages/ir/src/snapshot/`):

- **Canonical JSON.** Keys sorted by code unit, `undefined` entries dropped,
  two-space indent and a trailing LF for files. The same key order without
  whitespace for hashing.
- **Per-resource digests.** The SHA-256 of the compact canonical JSON of
  `{ kind, kind_version, key, spec }`.
- **A package revision.** The SHA-256 of the manifest with each resource's
  path removed. The manifest holds the IR version, the package's name and
  version, `requires`, resources with their digests, inputs, and install
  order. The deploy operation recomputes the revision and refuses a package
  whose content does not match its pin. A different revision under a
  deployed name is refused, because a certified package is never replaced in
  place.
- **Source locations outside the hash.** Each builder records its call site
  as `meta.source = { kind, file, line }`, by reading a stack trace. The
  digest is computed before `meta` is attached, so moving code never changes
  a pin.
- **Derived `requires`.** `Package.define` walks the references of each
  definition in install order and records those owned by another package, in
  first-use order. Ownership of types and attributes is tracked in a
  `WeakMap` from handle to package.
- **A staleness check** in each package's tests rebuilds the snapshot and
  compares files byte for byte.

One consequence of the last two points: the staleness check compares bytes,
including `meta.source`. Moving a builder call to another line changes no
digest and no revision, but still makes the snapshot stale.

worldvm made the same choice independently. Its `contentDigest`
(`packages/ir-checks/src/content-digest.ts`) is SHA-256 over sorted-key
canonical JSON with every `at` key removed, because "moving code is not a
semantic change." worldvm uses it for library, account and contract digests.

## Current state

- **Canonical JSON.** `artifact/canonical-json.ts` sorts keys and writes no
  whitespace:

  ```ts
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, JsonValue>)[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
  ```

  `JsonValue` excludes `undefined` by type, but a key whose value is
  `undefined` at run time would be written as `"k":undefined`. There is no
  file encoding and no test vectors.
- **The envelope.** `language-ts-artifact/v1` (`artifact/artifact.ts`) has a
  single `declarationsHash`: the SHA-256 over the canonical JSON of the array
  of every payload, in session order. Each declaration has
  `declarationId = kind:name` and the `sourceHash` of its file. The envelope
  also carries the session id, engine version, prelude fingerprint and source
  summaries, so the envelope as a whole is not reproducible; only the hash
  is.
- **Provenance.** `declarationProvenance` lists each declaration's source,
  form index and span, outside the payload.
- **Spans inside payloads.** Effect program declarations put spans inside
  the payload. A probe on main emitted `(type Status (Union :draft :sent))`
  twice, the second time preceded by two newlines and two spaces:

  ```text
  0eebea9e…  {"kind":"SchemaDef","name":"Status","schema":{"kind":"Literal",...,"span":{"sourceId":"m.forma","startOffset":13,...}}}
  34f3c8eb…  {"kind":"SchemaDef","name":"Status","schema":{"kind":"Literal",...,"span":{"sourceId":"m.forma","startOffset":17,...}}}
  ```

  The same probe with a prelude-defined form produced the same hash in both
  positions, because descriptor payloads carry no spans. For Effect program
  declarations, moving code, or renaming the file, changes the hash.
- **Module interfaces.** `artifact/modules.ts` computes a `publicExportHash`
  over exports whose canonical names are `${sourceId}/${name}`, so renaming a
  file changes it.
- **Packages.** RFC 0002 proposes a `forma.toml` manifest and a lockfile with
  "integrity data", and leaves their format open. Declarations have
  identities `{moduleId, declaration}`, where `moduleId` is a host-supplied
  file-instance id.

## Proposal

### Canonical JSON

Canonical JSON is RFC 8785 (JCS). For the values Forma emits, this matches
today's implementation: keys sorted by UTF-16 code unit, ECMAScript number
serialization, no whitespace. The proposal adds:

- `undefined` values are dropped and non-JSON values (functions, `NaN`,
  infinities) are errors. Today, plain-JSON projection silently turns a
  nonfinite `Float` into `null`
  ([design decisions](../design-decisions.md#distinct-int-and-float-values)),
  so a projection computing `(/ v 0.0)` emits `null` and succeeds. Under
  this rule it fails at the declaration.
- The **file encoding** of a canonical value is the same key order, two-space
  indentation, and one trailing LF, so committed files are identical on
  every platform.
- Test vectors in `conformance/artifacts/canonical-json.json`: key order
  with non-ASCII and astral keys, `-0`, large safe integers, escaped
  strings, and nested empty containers.

### Provenance never enters a digest

A payload contains no source locations. Spans move to a provenance sidecar
keyed by JSON pointer:

```json
{"declaration": "SchemaDef:Status",
 "spans": {"": {...}, "/schema": {...}, "/schema/fields/0": {...}}}
```

Stage 1 can reach the same digests sooner by making `span` a reserved key
that the digest function removes, as worldvm does with `at`. The sidecar
replaces that transition once Effect program payloads stop embedding spans.

### Declaration digests

```text
digest = sha256(canonicalJson({ kind, name, contract, payload }))
```

- `kind` and `name` are the declaration's summary kind and declared name.
- `contract` is its payload contract and version, such as
  `mechanics/schema-def/v0`.
- `payload` is the canonical payload, with references written as declaration
  identities (below).

The digest leaves out the module path, the file, the source hash, the engine
version and the prelude fingerprint. If a prelude change does not change a
payload, the digest does not change. Each packaged declaration gains
`digest`, and `declarationsHash` becomes the hash of the sorted list of
`{ kind, name, digest }` records, which makes it independent of session
order.

### References and ownership

A reference inside a payload is written as `{ package, name }`, not as a
file path. Within a package, the name is enough; the module that declares
it is recorded in the manifest. Re-exports keep the original identity, as
RFC 0002 already requires.

Ownership needs no extra bookkeeping. The package that owns a declaration
is the package whose module declares it. That is resolved identity, which
the module graph already computes.

### Derived requirements

A package's `requires` is computed, never written:

1. Walk the package's declarations in install order. Install order is
   module dependency order, then declaration order within a module.
2. Within a declaration, walk its resolved references in canonical payload
   order. The emitter already visits references (`artifact/emit.ts`).
3. Record each reference owned by another package, the first time it is
   seen, under that package.

The result is `[{ package, declarations: [{ kind, name, digest }] }]` in
first-use order. A reference to a package that the manifest does not list
as a dependency is an error, `package/undeclared-dependency`, at the
reference's span. Including the referenced declaration's digest in
`requires` means a dependency's change changes the dependent's revision,
which is what a deploy pin needs.

### Package revision

```text
revision = sha256(canonicalJson({
  format: "forma-package/v1",
  package: { name, version },
  requires,                                  // as derived above
  declarations: [{ kind, name, digest }],   // sorted by kind, then name
  exports: [{ name, kind }],                // sorted
  install: [{ kind, name }]                 // install order
}))
```

Module paths, spans, source hashes, timestamps, session ids and engine
versions are excluded. Moving a file within a package, or moving code within
a file, changes no digest and no revision. Reordering declarations changes
only `install`, which is part of the revision because initialization order
is observable.

The revision is the integrity value RFC 0002's lockfile records for a
Forma package, and the pin a host deploys.

### Snapshots

`forma snapshot <package> --out <dir>` writes:

```text
manifest.json            # the revision inputs, plus each declaration's module and file
<kind>.ir.json           # payloads, one file per kind, canonical file encoding
provenance.json          # spans by declaration and pointer
```

`--check` rebuilds in memory and compares. It reports three results
separately:

- **stale content:** a digest or revision differs. This fails the check.
- **stale layout:** a declaration moved between modules. `manifest.json`
  differs but the revision does not. This fails the check.
- **stale provenance:** only `provenance.json` differs. This fails only
  with `--check=strict`.

This avoids onb-next's situation, where moving a line fails the check
although nothing a deploy depends on has changed. Tooling that jumps to
source can still demand fresh provenance with `--check=strict`.

### Relation to the envelope

`language-ts-artifact/v1` stays the session-level output for hosts and the
surface goldens. The package snapshot is a new derived artifact, listed in
`derivedArtifacts` next to `DerivedManifest`. Both are computed from the
same validated declarations, so their digests agree.

## Alternatives considered

- **Hash the envelope as written.** The envelope contains session ids and
  engine versions, so two builds of the same source would never match.
- **Keep spans in payloads and strip a reserved key forever.** This works,
  as worldvm shows, but every payload author must avoid the reserved name,
  and the stripped payload is not the payload a host reads. The sidecar
  keeps one form of payload.
- **Write `requires` by hand.** It can drift from the references the
  package actually makes. onb-next derives it for the same reason.
- **Include module paths in digests.** Moving a declaration to another file
  is a refactoring, not a semantic change. The manifest still records the
  module, so a tool can see the move.

## Conformance

Fixtures in `conformance/artifacts/identity/`, each a small package before
and after one change, with the expected effect:

| Change | Digests | Revision | `--check` |
| --- | --- | --- | --- |
| Blank lines inserted before a declaration | same | same | provenance stale |
| File renamed within the package | same | same | layout stale |
| A payload value changed | that one changes | changes | content stale |
| Two declarations reordered | same | changes (`install`) | content stale |
| A dependency's referenced declaration changed | same | changes (`requires`) | content stale |
| A reference to an undeclared package | | | `package/undeclared-dependency` |

Every declaration kind in the example corpus is covered, including Effect
program declarations, descriptor forms and ontology forms. The existing
canonical IR golden and corpus counts keep their declarations and counts.
Their hash values change, because `declarationsHash` is redefined in stage
1; each changed value is reviewed.

## Implementation stages and validation

1. **Span-free digests.** Strip `span` in the digest function, add
   `digest` to packaged declarations, and redefine `declarationsHash` over
   sorted digests. Add the first identity fixtures. This needs no package
   model.
2. **Canonical JSON specification.** RFC 8785 alignment, the `undefined`
   rule, the file encoding and test vectors.
3. **Provenance sidecar.** Remove spans from Effect program payloads and
   record them by pointer.
4. **Packages.** With RFC 0002 stage 3's manifest: identity-based
   references, derived `requires`, the revision, snapshots and `--check`.

Stage 1 changes stored artifact goldens. Each changed golden is reviewed and
explained.

## Decisions still required

- Whether `install` order belongs in the revision (proposed) or only in the
  manifest.
- Whether a dependency's digest belongs in `requires` (proposed), which
  makes revisions change transitively, or only its name and version.
- Whether `version` belongs in the revision. onb-next includes it; a
  content-addressed pin arguably should not.
- The definition of `publicExportHash` after the change: keep its current wire
  format, or redefine it over identities.

## Related designs

- [RFC 0002](./0002-modules-and-packages.md): package identity, manifests
  and lockfiles.
- [RFC 0016](./0016-host-call-journals.md): journals record artifact
  identity to detect divergence. A span-free digest means a journal survives
  reformatting.
- [RFC 0021](./0021-ir-to-source.md): pointers into payloads are the same
  JSON pointers this RFC uses for provenance.
- [RFC 0025](./0025-consumer-prelude-sdk.md): worldvm's `digest.ts` is
  covered here.
