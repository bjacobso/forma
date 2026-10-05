import { Effect } from "effect";
import { PRELUDE_SOURCE } from "@formalang/ts/expander";
import {
  generateEffectProgram,
  generateMechanicsEffectSchemaModule,
  mechanicsPackageableDeclarations,
} from "@formalang/ts/mechanics";
import { parseManyToSExpr } from "@formalang/ts/reader";
import { canonicalIrMediaType, schemaDeclarationsJson } from "./canonicalIr";
import {
  contractSource,
  defineEntityDescriptor,
  entitySchemaSource,
  undeclaredCapabilitySource,
  undeclaredFailureSource,
} from "./sources";
import type { PipelineDef } from "./types";

const helloSource = `(let [rate 150
      hours 40
      revenue (* rate hours)
      cost 4000
      margin (- revenue cost)
      margin-pct (/ margin revenue)]
  {:revenue revenue
   :cost cost
   :margin margin
   :margin-pct (round (* margin-pct 100))})`;

const pipesSource = `(define orders [12 30 18 7])

(->> orders
  (map (fn [total] (* total 100)))
  (reduce + 0))`;

const typesSource = `(fn [x] (+ x 1))`;

const typesRecordSource = `(fn [order]
  (+ (get order :subtotal) (get order :tax)))`;

const typesBrokenSource = `(fn [x] (+ x "oops"))`;

const gradesSource = `(define grade (fn [score]
  (cond
    (>= score 90) "A"
    (>= score 80) "B"
    (>= score 70) "C"
    (>= score 60) "D"
    :else "F")))

(map grade [95 82 75 63 45])`;

const effectTsSource = `(define-schema CheckoutLine
  (Struct
    (field sku String)
    (field quantity Int)
    (field price-cents Int)))

(define-schema CheckoutRequest
  (Struct
    (field cart-id (Brand CartId String))
    (field customer-id (Brand CustomerId String))
    (field coupon (Optional String))
    (field lines (Array CheckoutLine))))

(define-schema Cart
  (Struct
    (field cart-id (Brand CartId String))
    (field lines (Array CheckoutLine))))

(define-schema PricedCart
  (Struct
    (field cart Cart)
    (field total-cents Int)))

(define-schema CheckoutResult
  (Struct
    (field order-id String)
    (field total-cents Int)))

(define-error CheckoutRejected
  (:fields
    (field reason String)))

(define-service CartRepo
  (:methods
    (load [request CheckoutRequest] (Effect Cart [CheckoutRejected] []))))

(define-service Pricing
  (:methods
    (price [cart Cart request CheckoutRequest] (Effect PricedCart [CheckoutRejected] []))))

(define-service Orders
  (:methods
    (create [priced PricedCart] (Effect CheckoutResult [CheckoutRejected] []))))

(: checkout (-> CheckoutRequest (Effect CheckoutResult [CheckoutRejected] [CartRepo.load Pricing.price Orders.create])))
(define-operation checkout [request]
  (do!
    [cart (<- (CartRepo.load request))
     priced (<- (Pricing.price cart request))
     order (<- (Orders.create priced))]
    (succeed order)))`;

const schemaSource = `(define-schema CheckoutLine
  (Struct
    (field sku String)
    (field quantity Int)
    (field price-cents Int)))

(define-schema CheckoutRequest
  (Struct
    (field cart-id (Brand CartId String))
    (field customer-id (Brand CustomerId String))
    (field coupon (Optional String))
    (field lines (Array CheckoutLine))))`;

const threadLastMacro = preludeSection(";; ->>") ?? `(define-macro ->> [x & forms]
  ...)`;

export const pipelines: readonly PipelineDef[] = [
  {
    id: "entities",
    group: "domain",
    title: "Keywords Are Library Code",
    tagline: "Entity and query keywords come from a prelude, not the compiler, and elaborate into typed IR.",
    badge: "preview",
    source: entitySchemaSource,
    passes: ["parse", "expand"],
    context: {
      label: "Descriptor from preludes/ontology.lisp",
      code: defineEntityDescriptor,
    },
    preview: {
      targetLabel: `Canonical IR declarations (${canonicalIrMediaType})`,
      language: "json",
      output: schemaDeclarationsJson(),
      notice:
        "Pinned output of the OCaml engine's canonical-ir backend for this exact source (conformance/fixtures/canonical-ir, checked in CI). The browser engine does not run ontology elaboration yet, so edits do not change this pane.",
    },
    narration: [
      {
        stage: "source",
        md: "`define-entity` is not a compiler keyword. The descriptor below the editor comes from `preludes/ontology.lisp` and declares the form's slots, the name it binds, its result type, and the hook that constructs its output.",
      },
      {
        stage: "parse",
        md: "Reading is domain-neutral. The reader sees ordinary lists, vectors, and maps, and every node keeps its source span.",
      },
      {
        stage: "expand",
        md: "These forms are descriptors, not macros, so expansion leaves them intact for the elaborator.",
      },
      {
        stage: "target",
        md: "Elaboration resolves `Employee`, checks that `:where` is boolean, projects the selected fields, and emits typed declarations. This is the artifact the OCaml engine produces for this source.",
      },
    ],
  },
  {
    id: "contracts",
    group: "domain",
    title: "The Type Says What Code Can Do",
    tagline: "Inference names an operation's result, its failures, and every capability it touches. Leave one out and it won't compile.",
    badge: "live",
    source: contractSource,
    passes: ["parse", "expand", "typecheck"],
    variants: [
      {
        id: "declared",
        label: "Declared",
        source: contractSource,
        stage: "typecheck",
        description: "The signature lists the failure and the capability the body uses.",
      },
      {
        id: "missing-capability",
        label: "Missing capability",
        source: undeclaredCapabilitySource,
        stage: "typecheck",
        description: "The body calls Console.print, but the signature requires nothing.",
      },
      {
        id: "missing-failure",
        label: "Missing failure",
        source: undeclaredFailureSource,
        stage: "typecheck",
        description: "Console.print can fail with ConsoleUnavailable, but the signature says it cannot fail.",
      },
    ],
    narration: [
      {
        stage: "source",
        md: "`define-service` declares a capability and how it can fail. `log` calls `Console.print`, and its signature says so.",
      },
      {
        stage: "typecheck",
        md: "Inference produces `Effect<Unit, ErrorSet<ConsoleUnavailable>, RequirementSet<Console.print>>`: the success value, the closed set of failures, and the closed set of required capabilities.",
      },
      {
        stage: "typecheck",
        md: "Switch to a variant that drops `Console.print` or `ConsoleUnavailable` from the signature. The typechecker rejects the operation and the diagnostic points at the `define-operation` form.",
      },
    ],
  },
  {
    id: "effect-ts",
    group: "domain",
    title: "Contracts Generate Effect TypeScript",
    tagline: "Services and operations become Effect TypeScript, and each required capability becomes a Context service.",
    badge: "preview",
    source: effectTsSource,
    passes: ["parse"],
    preview: {
      targetLabel: "Generated Effect TypeScript",
      language: "typescript",
      output: effectTypeScriptTarget(effectTsSource),
      notice: "This target is generated in-browser from mechanics service and operation declarations through @formalang/ts/mechanics.",
    },
    narration: [
      {
        stage: "parse",
        md: "`define-service` and `define-operation` describe a typed effect boundary. The live pass reads those forms into mechanics artifacts.",
      },
      {
        stage: "target",
        md: "The target pane lowers service requirements into Effect Context tags and turns `<-` bindings into `yield*` inside `Effect.gen`.",
      },
    ],
  },
  {
    id: "effect-schema",
    group: "domain",
    title: "Schemas Generate Validators",
    tagline: "Forma schema declarations compile into Effect Schema validators.",
    badge: "preview",
    source: schemaSource,
    passes: ["parse"],
    preview: {
      targetLabel: "Generated Effect Schema",
      language: "typescript",
      output: effectSchemaTarget(schemaSource),
      notice: "This target is generated in-browser from the parsed Forma schema declarations through @formalang/ts/mechanics.",
    },
    narration: [
      {
        stage: "source",
        md: "`define-schema` is already a Forma mechanics artifact form. The live pass reads the Lisp source into structured forms.",
      },
      {
        stage: "target",
        md: "The target pane is generated from those parsed schema declarations through `@formalang/ts/mechanics`, then emitted as Effect Schema code.",
      },
    ],
  },
  {
    id: "full-pipeline",
    group: "core",
    title: "The Complete Pipeline",
    tagline: "One program through every pass: a `cond` macro expands, a function infers, and the value projects to JSON.",
    badge: "live",
    source: gradesSource,
    passes: ["parse", "expand", "typecheck", "evaluate"],
    target: {
      targetLabel: "Portable JSON result",
      language: "json",
      notice: "Generated live from the evaluated value. Edit the source to update this projection.",
    },
    narration: [
      { stage: "source", md: "Edit the grade function or its sample scores. Every stage below runs again from this source." },
      { stage: "parse", md: "Read turns the text into an S-expression tree with source locations." },
      { stage: "expand", md: "The prelude's `cond` macro expands to the smaller core language." },
      { stage: "typecheck", md: "Typecheck infers types for the grade function and its expressions." },
      { stage: "evaluate", md: "Eval runs the checked program and produces a list of grades." },
      { stage: "target", md: "The evaluated list is projected into portable JSON. This result updates when the source changes." },
    ],
  },
  {
    id: "types",
    group: "core",
    title: "Types Without Writing Types",
    tagline: "Infer the shape of a function from how its body uses values.",
    badge: "live",
    source: typesSource,
    passes: ["parse", "expand", "typecheck"],
    variants: [
      {
        id: "inferred",
        label: "Scalar",
        source: typesSource,
        stage: "typecheck",
        description: "Scalar function inference path.",
      },
      {
        id: "record-row",
        label: "Record",
        source: typesRecordSource,
        stage: "typecheck",
        description: "Infer an open record shape from field reads.",
      },
      {
        id: "type-error",
        label: "Type error",
        source: typesBrokenSource,
        stage: "typecheck",
        description: "Real typecheck diagnostic path.",
      },
    ],
    narration: [
      {
        stage: "source",
        md: "There are no type annotations here. The body adds one, so the argument and result are constrained by use.",
      },
      {
        stage: "typecheck",
        md: "The typecheck pass produces the headline inferred type and a table of every expression type the engine exposes. The record variant infers a row shape from `get` calls.",
      },
      {
        stage: "typecheck",
        md: "Switch to the type-error variant, or edit `1` into a string, to make the diagnostic land on the typecheck stage instead of turning into a runtime surprise.",
      },
    ],
  },
  {
    id: "pipes",
    group: "core",
    title: "The Pipe Operator Is a Library",
    tagline: "`->>` is a prelude macro, not syntax, so it expands away before typechecking.",
    badge: "live",
    source: pipesSource,
    passes: ["parse", "expand"],
    context: {
      label: "Prelude macro loaded before expansion",
      code: threadLastMacro,
    },
    narration: [
      {
        stage: "source",
        span: [29, 33],
        md: "`->>` looks like built-in syntax, but it is just a macro from the Forma prelude.",
      },
      {
        stage: "expand",
        md: "After expansion, the pipe is gone. What remains is ordinary function application that the later passes already understand.",
      },
    ],
  },
  {
    id: "hello",
    group: "core",
    title: "A Tiny Program",
    tagline: "Numbers and maps flow from source text into a concrete value.",
    badge: "live",
    source: helloSource,
    passes: ["parse", "evaluate"],
    narration: [
      {
        stage: "source",
        md: "Start with a small accounting expression. It is plain text, but every bracket and symbol will become structured data.",
      },
      {
        stage: "parse",
        md: "The read pass turns characters into an S-expression tree. Forma keeps spans, so every tree node still knows where it came from.",
      },
      {
        stage: "evaluate",
        md: "Evaluation runs the program in your browser and returns a map. The compiler did not need a server to understand or run this source.",
      },
    ],
  },
];

// Retired demo ids that shared links may still use.
const pipelineAliases: Readonly<Record<string, string>> = {
  grades: "full-pipeline",
};

export function getPipeline(id: string | undefined): PipelineDef {
  const resolved = id === undefined ? undefined : (pipelineAliases[id] ?? id);
  return pipelines.find((pipeline) => pipeline.id === resolved) ?? pipelines[0]!;
}

function preludeSection(marker: string): string | null {
  const start = PRELUDE_SOURCE.indexOf(marker);
  if (start === -1) return null;
  const next = PRELUDE_SOURCE.indexOf("\n;; ", start + marker.length);
  return PRELUDE_SOURCE.slice(start, next === -1 ? undefined : next).trim();
}

function effectSchemaTarget(source: string): string {
  const exprs = Effect.runSync(parseManyToSExpr(source));
  const result = mechanicsPackageableDeclarations(exprs, "effect-schema");
  if (!result.ok) {
    return JSON.stringify({ diagnostics: result.diagnostics }, null, 2);
  }
  return generateMechanicsEffectSchemaModule(result.declarations).code;
}

function effectTypeScriptTarget(source: string): string {
  const result = generateEffectProgram(source, { sourceId: "effect-ts" });
  if (!result.ok || result.code === undefined) {
    return JSON.stringify({ diagnostics: result.diagnostics }, null, 2);
  }
  return result.code;
}
