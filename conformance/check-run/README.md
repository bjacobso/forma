# Checker against evaluator

`packages/ts/test/check-run.test.ts` calls the public in-process `Engine.typecheck`
and `Engine.evaluate` independently on fresh environments. The evaluator runs
unchecked, with a 10,000-step limit. No engine behavior is changed by this harness.

Run the bounded CI exploration (150 programs, fixed fast-check seed 20261111):

```sh
pnpm --filter @formalang/ts test test/check-run.test.ts
```

Run longer exploration locally:

```sh
FORMA_CHECK_RUN_RUNS=5000 pnpm --filter @formalang/ts test test/check-run.test.ts
```

A failure prints the minimized program, its classification, and fast-check's seed
and replay path. Exploration stops at the first blocking counterexample and
shrinks it. Long runs also print the count and up to ten examples of distinct
nonblocking false rejections. Generated programs are well scoped, bounded, and
nonrecursive; recursive expression generators shrink literals and syntax.
Arithmetic uses small numbers and nonzero divisors to avoid overflow and division
by zero dominating exploration. Higher-order numeric boundary probes complement
composed expressions, identity functions, records, and tagged matches.

## Classification

- `agree`: both reject/fail, or checking accepts and evaluation succeeds with
  compatible primitive tags.
- `accepted-but-fails`: checking accepts but evaluation reports an error.
- `type-disagrees`: evaluation succeeds but its value disagrees with a displayed
  `Int`, `Float`, `String`, `Bool`, or `List` of one of those types. Every list
  element is checked; empty lists are compatible with any item type. Ints are
  JavaScript numbers, while Floats are boxed `KFloat` values, including 1.0.
- `rejected-but-runs`: checking rejects but unchecked evaluation succeeds. Only
  seeds require ledger entries for this category: many such rejections are
  legitimate (for example incompatible types in an unreachable branch).

Other displayed types, including functions, records, and tagged types, are
checked for evaluation failure but not value/type compatibility. The harness
compares only the final value and displayed result type. It is a bounded bug
finder, not a proof of soundness or a test of compiled JavaScript.

## Adding a seed

Add one self-contained `.lisp` program under `seeds/`. Files are automatically
discovered. Prefer an agreeing regression covering a construct or a minimized
counterexample. Run the test; any unlisted seed divergence fails, including
`rejected-but-runs`. There must always be at least 15 agreeing seeds.

## Ledger policy and pruning

`known-divergences.json` is the reviewed baseline, not an output file. Each entry
has a unique `id`, exactly one of `seed` (relative to this directory) or `program`
(exact minimized source text), a `category`, and a one-line `note`. Surrounding
whitespace is ignored; no generalization or pattern matching masks related bugs.
All entries are reclassified every run, including generated counterexamples that
the current random sample does not encounter. A fixed or recategorized entry
fails immediately. When fixing a divergence, remove its entry and retain its seed
(or promote its program into a seed) to prevent recurrence. Deleting a live entry
fails when its seed or generated program is exercised.

The initial measurement package establishes this baseline. Subsequent fixes
should only shrink it. Do not automatically append new failures, update expected
categories, or regenerate the ledger to make a test pass: investigate new
counterexamples and resolve them in the engine. No automatic ledger update mode
is provided.

## Baseline observations

E1 and E2 reproduce the reported arity and mapped numeric-kind divergences.
E3, `(reduce + 0 [1 2 3])`, differs from the task's expected baseline: the rebuilt
CLI (`file evaluate --unchecked <file>`) and in-process evaluator both fail with
`reduce: expected function, got function`. Checking also rejects it, so it is an
agreeing seed, not a false ledger entry for `rejected-but-runs`. R1 explicitly
exercises the latter category using incompatible types in an unselected branch.

Initial 5,000-run exploration found G1–G5: mapped arithmetic, numeric filtering,
and reducing arithmetic display Float results while returning Int values; mixed
Int/Float `if` branches also display Float while the chosen branch returns Int.
