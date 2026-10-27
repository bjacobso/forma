/**
 * Forma → Go: an isolated prototype generator for RFC 0019. It elaborates
 * an Effect program with the same reader, projection, and checker as the
 * Effect TypeScript target, then generates a Go package for the effect-go
 * runtime prototype in `prototypes/effect-go`. TypeScript engine only.
 *
 * @module EffectGo
 */
import type { PackageableDeclaration } from "./artifact/artifact.js";
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
