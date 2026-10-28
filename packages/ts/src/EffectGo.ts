/**
 * Forma → Go: an isolated prototype generator for RFC 0019. It elaborates
 * an Effect program with the same reader, projection, and checker as the
 * Effect TypeScript target, then generates a Go package for the effect-go
 * runtime prototype in `prototypes/effect-go`. TypeScript engine only.
 *
 * @module EffectGo
 */
import type { PackageableDeclaration } from "./artifact/artifact.js";
import { linkHttpApiProgram } from "./artifact/http-api-link.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { emissionDatum, emitFormExpression, renderGo } from "./descriptor/form-emitter.js";
import { elaborateEffectProgram, type EffectProgramDiagnostic, type EffectProgramSpan } from "./mechanics/elaborate.js";
import { EffectGoUnsupportedError, generateMechanicsEffectGoModule } from "./mechanics/effect-go.js";

export { EffectGoUnsupportedError, generateMechanicsEffectGoModule, type MechanicsEffectGoModule, type MechanicsEffectGoOptions } from "./mechanics/effect-go.js";

export interface EffectGoDiagnostic {
  readonly phase: EffectProgramDiagnostic["phase"] | "generate";
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly span?: EffectProgramSpan;
}

export interface EffectGoProgramOptions {
  /** Identifies the source in spans; defaults to `"program.lisp"`. */
  readonly sourceId?: string;
  /** The Go package name. */
  readonly packageName: string;
  /** Module path of the effect-go runtime. */
  readonly runtimeModule?: string;
}

export interface EffectGoProgramResult {
  /** True when no diagnostic is an error. */
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly EffectGoDiagnostic[];
  /** The generated Go source; present only when generation succeeded. */
  readonly code?: string;
  readonly operationNames?: readonly string[];
}

/** Checks a Forma Effect program and, when it checks, generates Go. */
export function generateEffectGoProgram(source: string, options: EffectGoProgramOptions): EffectGoProgramResult {
  const elaboration = elaborateEffectProgram(source, options.sourceId === undefined ? {} : { sourceId: options.sourceId });
  if (!elaboration.ok || !elaboration.check) return elaboration;
  try {
    const module = generateMechanicsEffectGoModule(elaboration.declarations, {
      packageName: options.packageName,
      check: elaboration.check,
      ...(options.runtimeModule === undefined ? {} : { runtimeModule: options.runtimeModule }),
    });
    return { ...elaboration, code: module.code, operationNames: module.operationNames };
  } catch (error) {
    if (!(error instanceof EffectGoUnsupportedError)) throw error;
    return {
      ok: false,
      declarations: elaboration.declarations,
      diagnostics: [
        ...elaboration.diagnostics,
        {
          phase: "generate",
          severity: "error",
          code: "effect-go/unsupported",
          message: `The effect-go prototype does not translate ${error.message} yet.`,
        },
      ],
    };
  }
}

export interface HttpApiGoProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  /** The generated Go source; present only when generation succeeded. */
  readonly code?: string;
}

/**
 * The Go backend of the http-api prelude linker. It shares the host-neutral
 * check with `generateHttpApiProgram`, generates the Effect program as Go,
 * and appends the prelude forms through their `:go` emit hooks, which target
 * the prototype's `httpapi` package.
 */
export function generateHttpApiGoProgram(source: string, options: EffectGoProgramOptions): HttpApiGoProgramResult {
  const link = linkHttpApiProgram(source, options.sourceId ?? "http-api.forma");
  if (!link.ok) return { ok: false, declarations: link.declarations, diagnostics: link.diagnostics };
  const { declarations, diagnostics } = link;
  let module: ReturnType<typeof generateMechanicsEffectGoModule>;
  try {
    module = generateMechanicsEffectGoModule(link.mechanics.declarations, {
      packageName: options.packageName,
      check: link.mechanics.check!,
      runtimePackages: link.domain.length > 0 ? ["httpapi"] : [],
      ...(options.runtimeModule === undefined ? {} : { runtimeModule: options.runtimeModule }),
    });
  } catch (error) {
    if (!(error instanceof EffectGoUnsupportedError)) throw error;
    return {
      ok: false,
      declarations,
      diagnostics: [...diagnostics, { code: "effect-go/unsupported", severity: "error", phase: "typecheck", message: `The effect-go prototype does not translate ${error.message} yet.` }],
    };
  }
  const names = new Set(module.declaredNames);
  const chunks: string[] = [];
  for (const d of link.domain) {
    const exportName = link.exportName(d);
    if (names.has(exportName)) {
      link.report(d, "name-collision", `Generated name ${exportName} is already in use.`);
      continue;
    }
    names.add(exportName);
    try {
      const expression = emitFormExpression(link.descriptor(d.formName!), emissionDatum(d.payload), link.descriptors, link.schemaAnnotations, { host: "go", go: module.naming });
      chunks.push(`// ${exportName} is the ${d.formName} declaration ${exportName}.\nvar ${exportName} = ${renderGo(expression)}`);
    } catch (error) {
      // A form without a :go hook is reported on that form.
      link.report(d, "emit", error instanceof Error ? error.message : String(error));
    }
  }
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, declarations, diagnostics };
  return { ok: true, declarations, diagnostics, code: `${module.code.trimEnd()}\n\n${chunks.join("\n\n")}\n` };
}
