/**
 * Unified HM entry point for checking Effect programs and producing the
 * checked binding/type/effect-set summary consumed by IR projection & codegen
 * (Wave U3 cutover / U6).
 */
import { Effect, Layer, Ref } from "effect";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import type { SExpr } from "../reader/types.js";
import { expandEffectDeclarations, expandEffectLibrary } from "../mechanics/effect-library.js";
import { lowerOntologyOperations } from "../surface/ontology-effect.js";
import type { Type } from "./types.js";
import { showType } from "./types.js";
import type { TypeEnv } from "./substitution.js";
import type { Span } from "./core-expr.js";
import { resetNodeIds } from "./core-expr.js";
import {
  InferContext,
  makeOwnedInferContext,
  type InferDiagnostic,
  type NodeTypeMap,
} from "./context.js";
import { inferProgram } from "./infer.js";
import { lowerProgram } from "./lower.js";
import { unifiedFormProvider } from "./unified-form-provider.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import type { BuiltinSchemeProvider } from "./builtin-schemes.js";
import {
  extractOperationalEffect,
  type EffectProvenance,
  type OperationalEffect,
} from "./effect-sets.js";
import { effectBuiltinScheme, extractLayer } from "./infer-effect.js";

export interface CheckedLayerSummary {
  readonly provides: EffectProvenance;
  readonly errors: EffectProvenance;
  readonly requirements: EffectProvenance;
}

export interface CheckedEffectBinding {
  readonly name: string;
  readonly type: Type;
  readonly display: string;
  readonly effect?: OperationalEffect | undefined;
  readonly layer?: CheckedLayerSummary | undefined;
  readonly span?: Span | undefined;
}

export interface CheckEffectProgramOptions {
  readonly sourceId?: string | undefined;
  readonly dslProvider?: DSLTypeProvider | undefined;
  readonly builtinScheme?: BuiltinSchemeProvider | undefined;
  readonly initialEnv?: TypeEnv | undefined;
}

export interface CheckedEffectProgram {
  readonly ok: boolean;
  readonly phase?: "read" | "surface" | "lower" | "infer" | undefined;
  readonly bindings: ReadonlyMap<string, CheckedEffectBinding>;
  readonly services: ReadonlyMap<string, ReadonlyMap<string, Type>>;
  readonly errors: ReadonlySet<string>;
  readonly nodeTypes: NodeTypeMap;
  readonly diagnostics: readonly InferDiagnostic[];
}

function failResult(
  phase: "read" | "surface" | "lower" | "infer",
  diagnostics: readonly InferDiagnostic[],
): CheckedEffectProgram {
  return {
    ok: false,
    phase,
    bindings: new Map(),
    services: new Map(),
    errors: new Set(),
    nodeTypes: new Map(),
    diagnostics,
  };
}

function extractErrorSpan(error: unknown): { readonly start: number; readonly end: number } | undefined {
  if (typeof error === "object" && error !== null) {
    if ("origin" in error && typeof error.origin === "object" && error.origin !== null && "span" in error.origin) {
      const span = error.origin.span as { readonly start?: unknown; readonly end?: unknown } | undefined;
      if (typeof span?.start === "number" && typeof span?.end === "number") {
        return { start: span.start, end: span.end };
      }
    }
    if ("loc" in error && typeof error.loc === "object" && error.loc !== null) {
      const loc = error.loc as { readonly start?: unknown; readonly end?: unknown };
      if (typeof loc.start === "number" && typeof loc.end === "number") {
        return { start: loc.start, end: loc.end };
      }
    }
  }
  return undefined;
}

function extractErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "details" in error && typeof error.details === "object" && error.details !== null) {
    const code = (error.details as Record<string, unknown>)["code"];
    if (typeof code === "string") return code;
  }
  return fallback;
}

function extractFunctionEffect(type: Type): OperationalEffect | undefined {
  let cursor = type;
  while (cursor._tag === "TFun") cursor = cursor.res;
  return extractOperationalEffect(cursor);
}

/**
 * Check already-parsed (and optionally domain-lowered) Effect forms with the HM
 * checker, returning a structured summary of bindings, services, error types,
 * operational Effect sets, Layer sets, and diagnostics.
 */
export function checkEffectForms(
  authored: readonly SExpr[],
  source: string,
  options: CheckEffectProgramOptions = {},
): CheckedEffectProgram {
  let exprs: readonly SExpr[];
  try {
    exprs = expandEffectDeclarations(lowerOntologyOperations(authored));
  } catch (error) {
    const span = extractErrorSpan(error);
    return failResult("surface", [
      {
        code: extractErrorCode(error, "surface/invalid-form"),
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: "hm",
        ...(span ? { span } : {}),
      },
    ]);
  }

  let dslProvider: DSLTypeProvider | undefined;
  let coreExprs: ReturnType<typeof lowerProgram>;
  try {
    dslProvider = unifiedFormProvider(source, exprs, options.dslProvider);
    resetNodeIds();
    coreExprs = lowerProgram(exprs, dslProvider, { effectMode: true });
  } catch (error) {
    const span = extractErrorSpan(error);
    return failResult("lower", [
      {
        code: extractErrorCode(error, "typecheck/lower"),
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: "hm",
        ...(span ? { span } : {}),
      },
    ]);
  }

  return Effect.runSync(
    Effect.gen(function* () {
      const ctxService = yield* makeOwnedInferContext({
        effectMode: true,
        builtinScheme: effectBuiltinScheme(options.builtinScheme),
      });
      const layer = Layer.succeed(InferContext, ctxService);
      let capturedEnv: TypeEnv = new Map();
      const outcome = yield* Effect.result(
        Effect.provide(
          inferProgram(coreExprs, options.initialEnv, dslProvider, exprs, (env) => {
            capturedEnv = env;
          }),
          layer,
        ),
      );
      const diagnostics = [...(yield* Ref.get(ctxService.diagnostics))];
      const nodeTypes = new Map(yield* Ref.get(ctxService.nodeTypes));
      const services = new Map(
        [...(yield* Ref.get(ctxService.serviceRegistry))].map(([name, methods]) => [
          name,
          new Map(methods),
        ]),
      );
      const errors = new Set(yield* Ref.get(ctxService.errorTypes));

      if (outcome._tag === "Failure") {
        const failure = outcome.failure;
        const span = extractErrorSpan(failure);
        diagnostics.unshift({
          code: extractErrorCode(failure, "typecheck/type-mismatch"),
          message: failure.message,
          severity: "error",
          source: "hm",
          ...(span ? { span } : {}),
          ...(failure.help ? { help: failure.help } : {}),
          ...(failure.fix ? { fix: failure.fix } : {}),
          ...(failure.related ? { related: failure.related } : {}),
        });
        return {
          ok: false,
          phase: "infer" as const,
          bindings: new Map(),
          services,
          errors,
          nodeTypes,
          diagnostics,
        };
      }

      const bindings = new Map<string, CheckedEffectBinding>();
      for (const [name, scheme] of capturedEnv) {
        const eff = extractFunctionEffect(scheme.type);
        const layerSummary = extractLayer(scheme.type);
        bindings.set(name, {
          name,
          type: scheme.type,
          display: showType(scheme.type),
          ...(eff ? { effect: eff } : {}),
          ...(layerSummary ? { layer: layerSummary } : {}),
          ...(scheme.declaration ? { span: scheme.declaration } : {}),
        });
      }

      const hasErrors = diagnostics.some((d) => d.severity === "error");
      return {
        ok: !hasErrors,
        ...(hasErrors ? { phase: "infer" as const } : {}),
        bindings,
        services,
        errors,
        nodeTypes,
        diagnostics,
      };
    }),
  );
}

/**
 * Parse, expand `forma:effect`, lower, and HM-check an Effect program source.
 */
export function checkEffectProgram(
  source: string,
  options: CheckEffectProgramOptions = {},
): CheckedEffectProgram {
  const sourceId = options.sourceId ?? "program.lisp";
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(source);
  } catch (error) {
    const span = extractErrorSpan(error);
    return failResult("read", [
      {
        code: "read/syntax",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: "hm",
        ...(span ? { span } : {}),
      },
    ]);
  }
  if (parsed.errors.length > 0) {
    return failResult(
      "read",
      parsed.errors.map((e) => ({
        code: "read/syntax",
        message: e.message,
        severity: "error" as const,
        source: "hm",
        ...(e.loc ? { span: { start: e.loc.start, end: e.loc.end } } : {}),
      })),
    );
  }

  const library = expandEffectLibrary(toSExprMany(parsed.redTree, sourceId), sourceId);
  if (!library.ok) {
    return failResult(
      "surface",
      library.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        severity: "error" as const,
        source: "hm",
        ...(d.span ? { span: { start: d.span.startOffset, end: d.span.endOffset } } : {}),
      })),
    );
  }

  return checkEffectForms(library.exprs, source, options);
}
