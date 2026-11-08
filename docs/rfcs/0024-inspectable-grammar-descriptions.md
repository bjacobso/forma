# RFC 0024: Inspectable grammar descriptions

| | |
| --- | --- |
| Status | Proposed; evaluation only, not implemented |
| Created | 2026-11-08 |
| Scope | Named recursive syntax descriptions with structural parser and documentation/analysis interpretations |
| Related | [RFC 0021](./0021-languages-as-libraries.md)'s proposed syntax categories and library-owned surfaces; [RFC 0017](./0017-diagnostic-catalog.md)'s diagnostic catalog |
| Decision | Evaluate a small data representation before considering adoption; no reader or typechecker refactor is authorized by this RFC |

## Summary

Evaluate whether one inspectable description of a small recursive syntax category
can drive both structural recognition and useful documentation or analysis.
Represent recursion with explicit named references, not executable host-language
fixed points. Keep syntax recognition separate from name resolution, scope,
type inference, semantic validation, and elaboration.

The proposal is motivated by the idea behind Eitan Chatav's `BackusNaurForm`
interface: distinguish named rules from the operation that ties recursive rules
together, and permit multiple interpretations. It does not propose importing
the `Monoidal`, `Strong`, or `Costrong` hierarchy into Forma. In the screenshot,
`rule _ = idP` makes naming inert by default and `ruleRec _ = fixP` delegates
recursion to an interpreter. Neither signature alone provides inspectable rule
bodies, a parsing algorithm, or a termination guarantee; the definitions and
laws of those operations would be needed to establish stronger claims.

## Current implementation and motivation

- [The reader](../../packages/ts/src/reader/parser.ts) builds a lossless green/red
  tree with error recovery, then projects S-expressions for downstream stages.
  This proposal does not replace it or change lexical syntax.
- [Unified forms](../../packages/ts/src/surface/form.ts) describe positional
  holes, options, and repeated children. `matchFormSyntax` extracts authored
  syntax; it is not a general grammar interpreter.
- [Form descriptors](../../packages/ts/src/descriptor/FormDescriptor.ts) separate
  declarative shape from static strategies and named semantic hooks. Existing
  tooling already consumes this data; multiple consumers alone do not justify
  another abstraction.
- [Form authoring](../writing-a-form.md) supports child forms and category aliases,
  `(Expr Bool)`, declaration/reference holes, and scope/check hooks.
  [Descriptor application typing](../../packages/ts/src/type/descriptor-protocol.ts)
  runs inside the active HM environment. These are contextual obligations,
  not merely grammar productions.

RFC 0021 proposes broader syntax categories and library-owned surfaces; it is
marked proposed with stage 0 implemented. This RFC evaluates a possible supporting
representation, not an implementation of its syntax forms, hygiene, emitters, or
reader profiles. In particular, grammar descriptions do not establish the
invertibility proposed there. Matching syntax and reconstructing source from
lowered core require different information.

There is not yet evidence that current descriptors need replacement. The question
is whether explicit category references can remove concrete duplication between
recognition and documentation as RFC 0021 evolves. Existing descriptors remain
the source of truth for shipped forms throughout the evaluation.

## Proposed evaluation model

Use a finite table of named rules with an entry rule. Rule bodies are data:
literal matches, fixed primitive token classes, sequence, alternative, optional,
repetition, delimited containers, and references to other named rules. Record
authored rule locations and labels for diagnostics. Resolve references and reject
duplicate or missing rule names before interpreting the table.

Start with recognition over existing S-expression nodes and their child
sequences. A list constructor enters one list node, matches its children, and
requires the entire child sequence to match. Primitive matches consume one node;
an optional match may consume none. Success at the entry requires the whole input,
not an accepted prefix. A result retains rule labels, hole captures, and original
source spans; it does not evaluate or lower the captured syntax.

Distinguish matching a symbol node from resolving that symbol. Likewise, an
expression-category boundary delegates to the existing expression pipeline;
it must not claim to structurally describe every expression or prove its type.
Such boundaries are visibly opaque in documentation and static analysis.

The first interpreter recognizes structural syntax. The second renders named
productions and computes reference reachability, productivity, nullability, and
potential non-consuming recursion. Documentation and analysis must inspect the
same rule table without executing semantic hooks. This does not promise generated
examples, completion, formatting, a printer, or a public grammar API.

No new Forma authoring syntax is specified here. The notation below describes
candidate data and observable behavior, not an available prelude.

## Concrete recursive example

Consider a small predicate category over the reader's existing nodes:

```text
Predicate := Boolean
           | list(symbol("not"), ref(Predicate))
           | list(symbol("all"), oneOrMore(ref(Predicate)))
           | list(symbol("equals"), Symbol, Scalar)
Scalar    := Boolean | Number | String
```

`Boolean`, `Number`, `String`, and `Symbol` are disjoint reader-node classes.
`symbol("not")` matches that literal symbol, whereas `Symbol` accepts any symbol
node. Each `list` requires exactly its described children. The entry is
`Predicate`, with no trailing input.

```lisp
(all true (not false) (equals status "open"))
```

The parser interpretation should produce a labeled match with two recursive
children and an `equals` child whose `status` and `"open"` captures retain
their authored spans. The documentation interpretation should show the four
predicate alternatives and the recursive references, without infinitely
expanding them. Analysis should report both rules reachable and productive,
neither nullable, and no non-consuming recursion. Recursive calls descend into
proper child nodes of a finite reader tree.

Reject `(not true false)`, `(all)`, and `(equals status)` structurally, locating
the extra argument or missing expected child at its authored container. Accept
`(equals unknown-field "open")` structurally: whether `unknown-field` exists,
what type it has, and whether String is compatible are later scope/type checks.
This accepted-but-potentially-ill-typed case is a required boundary test.

## Recursion and operational semantics

Recursion does not by itself characterize context-free languages. Right-linear
recursive grammars can remain regular. Finite first-order productions with
alternation, concatenation, and recursive nonterminal references describe CFGs;
arbitrary host computations or semantic predicates need not stay within that
boundary. Over already-read S-expressions, structural categories are more
naturally tree descriptions; the reader has already handled delimiters.

The evaluation uses the following explicit policies:

- **Left recursion:** reject direct or indirect recursion that can re-enter a
  rule at the same input position without structural descent or consumption.
  For token grammars, `E := E "+" Number | Number` is the familiar rejected
  example. The diagnostic identifies the cycle, rather than allowing stack
  overflow. Descending through a list node in the predicate example is not
  left recursion at the same position. Supporting left recursion later would
  require an explicit algorithm decision, not just a fixed-point combinator.
- **Nullable cycles:** compute nullability to a fixed point on the finite table.
  Reject same-position recursion through nullable prefixes and repetition of
  a nullable body. `A := optional(ref(A))` and `many(optional(Boolean))` must
  be rejected before matching. Keep analysis separate from recursive execution.
- **Alternatives and ambiguity:** alternatives denote union, not PEG-style
  first-success choice. Keep distinct successful derivations; if more than one
  fully matches, return an ambiguity diagnostic instead of silently selecting
  one. A node class such as `Symbol` overlapping a literal symbol is a useful
  negative control. Static overlap checks may warn, but must not claim to decide
  general CFG ambiguity. A future ordered-choice operator would be distinct
  and documented as different semantics.
- **Termination and cost:** after rejecting non-consuming cycles, recursion must
  consume input or descend into a proper subtree, and repetition must progress.
  Finite input and finite alternatives then bound the derivation search, but
  do not guarantee acceptable runtime or stack use. The prototype uses explicit
  depth/work budgets and reports resource exhaustion separately from invalid
  syntax. It must not truncate search and report a supposedly unique match;
  no linear-time or arbitrary-CFG support claim is made.

An unsupported grammar, an invalid input, ambiguous input, and a resource limit
are different outcomes. Diagnostics retain their rule and input locations.

## Semantic boundary

The grammar interpreter owns structural alternatives, arity, captures, and
source locations. It does not own binding introduction, lexical scope,
declaration identity, type unification, effects, refinement checks, hook
execution, IR construction, or payload contract identity.

After recognition, pass original syntax and captures to existing semantic
mechanisms. `(Expr Bool)` still means checking an expression in its active
environment, not accepting a production named `Bool`. `(Declares X)` and
`(Refers X)` retain their contextual obligations. Grammar documentation may
link these obligations as annotations but must not execute them or claim the
grammar proves them. Procedural macros remain outside the inspectable subset.

An inspectable subset must be honest about opaque boundaries. It is not a way
to derive a full language specification from arbitrary hooks or to make the
programmable type system context-free. Recursive syntax also adds no recursive
type feature and changes no HM inference behavior.

## Alternatives

1. **Keep current descriptors and handwritten recognition.** The default if the
   experiment finds no material duplicated structure or diagnostic improvement.
2. **Extend existing form/category metadata only.** Prefer this if named child
   references provide the needed documentation without a new grammar evaluator.
3. **Use executable parser combinators or a profunctor interface.** Useful for
   composition, but ordinary functions do not automatically expose finite rule
   graphs. A reified representation and interpreter laws would still be needed.
4. **Adopt a general parser generator or generalized CFG parser.** Appropriate
   only for a demonstrated lexical grammar or ambiguity requirement. It adds
   machinery the current S-expression reader does not need.

## Bounded evaluation and decision gate

One follow-up experiment, if approved, is limited to the predicate category above
and one small existing child-form category selected from a prelude. First record
the current recognition, documentation, and diagnostic behavior for that category.
Derive a candidate table from existing descriptors where possible; do not create
a second maintained authority for the shipped language.

Build only the structural recognizer and documentation/analysis interpretation.
Exercise nested valid inputs, extra/missing children, unknown references, direct
and indirect left recursion, nullable repetition, ambiguity, and budget exhaustion.
Check spans against the source independently of generated matches. Include the
accepted unknown-field case and show that contextual rejection still belongs to
the existing checker. Compare the existing category's accepted/rejected cases,
captures, and diagnostic locations against its current implementation; any
intentional difference must be explained, not hidden by updating goldens.

Record handwritten duplication removed, representation and interpreter size,
diagnostic differences, and runtime/work counts as nesting and alternatives
increase. The resulting documentation must expose recursion and opaque semantic
boundaries without a second handwritten production list. Existing conformance
and surface goldens must remain unchanged; run `pnpm check` for any later code
experiment. Reader recovery, formatter output, and source provenance remain
compatibility constraints, not features to rebuild during this evaluation.

Stop after these two examples. Recommend adoption only if the shared description
removes concrete duplication, retains useful diagnostics and provenance, and has
acceptable measured cost without entangling syntax with typing. Prefer extending
current descriptors if that is simpler. Otherwise retain the existing design and
record the negative result. Broader grammar coverage, production integration,
new public APIs, and RFC 0021 implementation require a separate decision.

## Open questions

- Which existing child-form category has enough repeated structural knowledge
  to make the second example meaningful?
- Can the existing descriptor representation carry named references adequately,
  making a separate representation unnecessary?
- What depth and work budgets reflect real editor inputs without masking a
  performance problem? Choose from the experiment's measurements.
- If a later surface genuinely needs left recursion or ordered choice, which
  semantics and algorithm should it request explicitly?
