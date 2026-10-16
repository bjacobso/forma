# Frozen native input vocabulary

The TypeScript language rejects `Number` and `Num` and uses `Int` and `Float`.
The frozen OCaml reference accepts its historical floating annotations and
rejects explicit `Float` annotations. Its compiler is not changed.

`numeric-vocabulary.json` pins the exact shared-source edits from the old
vocabulary to the current one, with SHA-256 hashes of both versions. Native
fixture runners use `readNativeReferenceFileSync` to recover their original
inputs. New fixtures requiring different annotations can supply `sourceNative`
explicitly. This is an input dialect difference, not a conversion of numeric
literals, runtime values, output types, or projection kinds.

The parity runner maps reference spans back to the current authored positions
so changing the length of a type name does not create offset noise. Symbol and
type names remain visible as exact differences, reviewed in the numeric parity
matrix. Native/JavaScript target checks use the same reference input.

When editing a pinned source, review and update its edit list and both hashes.
The reader fails on stale entries rather than silently adapting new inputs.
