/**
 * InferContext — Effect service for type inference state.
 *
 * Provides:
 *  - Mutable substitution (Ref<Subst>)
 *  - Fresh type/row variable generation
 *  - NodeTypeMap population
 *  - Error reporting with Origin
 */
import { Context, Effect, Ref } from "effect";
import type { Type, Row, ERow, Constraint } from "./types.js";
import { TVar, RVar, EVar } from "./types.js";
import type { Kind } from "./kind.js";
import type { TypeExpr } from "./core-expr.js";
import type { Subst } from "./substitution.js";
import { emptySubst, applyType } from "./substitution.js";
import type { Origin } from "./errors.js";
import { InferenceError } from "./errors.js";
import { builtinScheme, type BuiltinSchemeProvider } from "./builtin-schemes.js";

// ---------------------------------------------------------------------------
// Pending constraint for deferred discharge
// ---------------------------------------------------------------------------

export interface PendingConstraint {
  readonly constraint: Constraint;
  readonly origin: Origin;
}

// ---------------------------------------------------------------------------
// NodeTypeMap: maps CoreExpr node IDs to their inferred types
// ---------------------------------------------------------------------------

export type NodeTypeMap = Map<string, Type>;

// ---------------------------------------------------------------------------
// Diagnostics: non-fatal warnings/errors from DSL form validation
// ---------------------------------------------------------------------------

export interface InferDiagnostic {
  /** Human-readable error or warning message */
  readonly message: string;
  /** Source span in the Lisp source */
  readonly span?: { readonly start: number; readonly end: number } | undefined;
  /** Severity level */
  readonly severity: "error" | "warning";
  /** Source identifier (e.g., "cel", "hm") */
  readonly source: string;
}

export type DiagnosticList = InferDiagnostic[];

/** Information about an algebraic data type */
export interface ADTInfo {
  /** Type parameters (e.g., ["a"] for Option) */
  readonly typeParams: readonly string[];
  /** Constructor names with their arities */
  readonly constructors: ReadonlyMap<string, number>;
}

/** Information about a type class */
export interface ClassInfo {
  /** Class name (e.g., "Eq", "Functor") */
  readonly name: string;
  /** Type parameters with kinds (e.g., [{name: "a", kind: KStar}]) */
  readonly typeParams: readonly { name: string; kind: Kind }[];
  /** Super class constraints (e.g., [Eq a] for Ord) */
  readonly supers: readonly Constraint[];
  /** Method names mapped to their type expressions */
  readonly methods: ReadonlyMap<string, Type>;
}

/** Information about a type class instance */
export interface InstanceInfo {
  /** Class name */
  readonly className: string;
  /** Concrete type args (e.g., [Num] for instance Eq Num) */
  readonly args: readonly Type[];
  /** Instance constraints (e.g., Eq a => Eq (List a)) */
  readonly constraints: readonly Constraint[];
  /** Method implementations (name → compiled expression) */
  readonly methods: ReadonlyMap<string, unknown>;
}

export interface AmbientEffectState {
  readonly row: ERow;
  readonly touched: boolean;
  readonly internalVars: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface InferContextService {
  /** Resolve a built-in type scheme for the active inference host. */
  readonly builtinScheme: BuiltinSchemeProvider;
  /** Resolve a host-owned unbound symbol as a literal type, if applicable. */
  readonly unboundSymbolType: (name: string) => Type | undefined;
  /** Current substitution state */
  readonly subst: Ref.Ref<Subst>;
  /** Map from node ID to inferred type */
  readonly nodeTypes: Ref.Ref<NodeTypeMap>;
  /** Non-fatal diagnostics accumulated during type checking */
  readonly diagnostics: Ref.Ref<DiagnosticList>;
  /** Type alias registry: maps alias names to their type expressions */
  readonly typeAliases: Ref.Ref<Map<string, TypeExpr>>;
  readonly nominalRecords: Ref.Ref<Map<string, Type>>;
  readonly typeAliasParams: Ref.Ref<Map<string, readonly string[]>>;
  /** Schema-backed error names that may appear in Effect error sets. */
  readonly errorTypes: Ref.Ref<Set<string>>;
  /** ADT registry: maps type name to its constructor info */
  readonly adtRegistry: Ref.Ref<Map<string, ADTInfo>>;
  /** Maps constructor name → type name for pattern matching */
  readonly constructorToType: Ref.Ref<Map<string, string>>;
  /** Type class registry: maps class name to its info */
  readonly classRegistry: Ref.Ref<Map<string, ClassInfo>>;
  /** Type class instance registry: maps class name to instances */
  readonly instanceRegistry: Ref.Ref<Map<string, InstanceInfo[]>>;
  /** Ambient effect row accumulated while inferring the current expression scope */
  readonly ambientEffects: Ref.Ref<AmbientEffectState>;
  /** Pending type class constraints to be discharged at program end */
  readonly pendingConstraints: Ref.Ref<PendingConstraint[]>;
  /** Generate a fresh type variable (optionally with a kind) */
  readonly freshTVar: Effect.Effect<Type>;
  /** Generate a fresh type variable with a specific kind */
  readonly freshTVarK: (kind: Kind) => Effect.Effect<Type>;
  /** Generate a fresh row variable */
  readonly freshRowVar: Effect.Effect<Row>;
  /** Generate a fresh effect row variable */
  readonly freshEVar: Effect.Effect<ERow>;
  /** Record the type for a node */
  readonly recordType: (nodeId: string, type: Type) => Effect.Effect<void>;
  /** Add a non-fatal diagnostic (does not halt inference) */
  readonly addDiagnostic: (diagnostic: InferDiagnostic) => Effect.Effect<void>;
  /** Fail with a type error */
  readonly fail: (
    origin: Origin,
    details: Record<string, unknown>,
  ) => Effect.Effect<never, InferenceError>;
}

export class InferContext extends Context.Service<InferContext, InferContextService>()("InferContext") {}

export interface MakeInferContextOptions {
  readonly builtinScheme?: BuiltinSchemeProvider;
  readonly unboundSymbolType?: (name: string) => Type | undefined;
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export function makeInferContext(
  options: MakeInferContextOptions = {},
): Effect.Effect<InferContextService> {
  return makeContext(options, false);
}

/**
 * @internal An annotation builder owned by one inference operation. Reads of
 * nodeTypes are live: callers must copy the map before publishing a snapshot.
 * Keep makeInferContext's copy-on-write behavior for public context consumers.
 */
export function makeOwnedInferContext(
  options: MakeInferContextOptions = {},
): Effect.Effect<InferContextService> {
  return makeContext(options, true);
}

function makeContext(
  options: MakeInferContextOptions,
  ownedNodeTypes: boolean,
): Effect.Effect<InferContextService> {
  let tvarCounter = 0;
  let rvarCounter = 0;
  let evarCounter = 0;

  return Effect.gen(function* () {
    const subst = yield* Ref.make<Subst>(emptySubst);
    const nodeTypes = yield* Ref.make<NodeTypeMap>(new Map());
    const diagnostics = yield* Ref.make<DiagnosticList>([]);
    const nominalRecords = yield* Ref.make<Map<string, Type>>(new Map());
    const typeAliases = yield* Ref.make<Map<string, TypeExpr>>(new Map());
    const typeAliasParams = yield* Ref.make<Map<string, readonly string[]>>(new Map());
    const errorTypes = yield* Ref.make<Set<string>>(new Set());
    const adtRegistry = yield* Ref.make<Map<string, ADTInfo>>(new Map([["Option",{typeParams:["a"],constructors:new Map([["Some",1],["None",0]])}],["Result",{typeParams:["a","e"],constructors:new Map([["Ok",1],["Err",1]])}]]));
    const constructorToType = yield* Ref.make<Map<string, string>>(new Map());
    const classRegistry = yield* Ref.make<Map<string, ClassInfo>>(new Map());
    const instanceRegistry = yield* Ref.make<Map<string, InstanceInfo[]>>(new Map());
    const initialAmbient = EVar(`e${evarCounter++}`);
    const ambientEffects = yield* Ref.make<AmbientEffectState>({
      row: initialAmbient,
      touched: false,
      internalVars: initialAmbient._tag === "EVar" ? new Set([initialAmbient.id]) : new Set(),
    });
    const pendingConstraints = yield* Ref.make<PendingConstraint[]>([]);

    return InferContext.of({
      builtinScheme: options.builtinScheme ?? builtinScheme,
      unboundSymbolType: options.unboundSymbolType ?? (() => undefined),
      subst,
      nodeTypes,
      diagnostics,
      typeAliases,
      nominalRecords,
      typeAliasParams,
      errorTypes,
      adtRegistry,
      constructorToType,
      classRegistry,
      instanceRegistry,
      ambientEffects,
      pendingConstraints,

      freshTVar: Effect.sync(() => TVar(`t${tvarCounter++}`)),

      freshTVarK: (kind: Kind) => Effect.sync(() => TVar(`t${tvarCounter++}`, kind)),

      freshRowVar: Effect.sync(() => RVar(`r${rvarCounter++}`)),

      freshEVar: Effect.sync(() => EVar(`e${evarCounter++}`)),

      recordType: (nodeId, type) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(subst);
          const resolved = applyType(s, type);
          yield* Ref.update(nodeTypes, (m) => {
            // Only the operation-owned annotation builder can be mutated.
            // Substitution and registry refs retain their snapshot semantics.
            const next = ownedNodeTypes ? m : new Map(m);
            next.set(nodeId, resolved);
            return next;
          });
        }),

      addDiagnostic: (diagnostic) => Ref.update(diagnostics, (list) => [...list, diagnostic]),

      fail: (origin, details) =>
        Effect.fail(
          new InferenceError({
            message: typeof details["message"] === "string" ? details["message"] : "Type error",
            origin,
            details,
          }),
        ),
    });
  });
}
