/**
 * One-call elaboration of an Effect program written in Forma: read the
 * source, project mechanics declarations, check them, and generate Effect
 * TypeScript. Every diagnostic carries a line/column span in the author's
 * source.
 *
 * @module
 */
import type { PackageableDeclaration } from "../artifact/artifact.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import { mechanicsPackageableDeclarations, type MechanicsArtifactDiagnostic } from "./artifact.js";
import { checkMechanicsDeclarations, type CheckInfo, type MechanicsCheckDiagnostic } from "./check.js";
import { generateMechanicsEffectTypeScriptModule } from "./effect-typescript.js";

export interface EffectProgramSpan {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface EffectProgramDiagnostic {
  readonly phase: "read" | "project" | "check";
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly span?: EffectProgramSpan;
}

export interface EffectProgramOptions {
  /** Identifies the source in spans; defaults to `"program.lisp"`. */
  readonly sourceId?: string;
}

export interface EffectProgramElaboration {
  /** True when no diagnostic is an error. */
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly EffectProgramDiagnostic[];
  readonly check?: CheckInfo;
}

export interface EffectProgramTypeScript extends EffectProgramElaboration {
  /** The generated module; present only when elaboration succeeded. */
  readonly code?: string;
  readonly operationNames?: readonly string[];
}

export function elaborateEffectProgram(
  source: string,
  options: EffectProgramOptions = {},
): EffectProgramElaboration {
  const sourceId = options.sourceId ?? "program.lisp";
  const lines = lineStarts(source);
  const locate = (startOffset: number, endOffset: number): EffectProgramSpan => {
    const start = position(lines, startOffset);
    const end = position(lines, endOffset);
    return {
      sourceId,
      startOffset,
      endOffset,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    };
  };

  const { redTree, errors } = parse(source);
  if (errors.length > 0) {
    return {
      ok: false,
      declarations: [],
      diagnostics: errors.map((error) => ({
        phase: "read",
        severity: "error",
        code: "read/syntax",
        message: error.loc ? error.message.replace(/ at line \d+, column \d+$/, "") : error.message,
        ...(error.loc ? { span: locate(error.loc.start, error.loc.end) } : {}),
      })),
    };
  }

  const projected = mechanicsPackageableDeclarations(toSExprMany(redTree), sourceId);
  if (!projected.ok) {
    return {
      ok: false,
      declarations: [],
      diagnostics: projected.diagnostics.map((diagnostic) => projectDiagnostic(diagnostic, locate)),
    };
  }

  const checked = checkMechanicsDeclarations(projected.declarations);
  return {
    ok: checked.ok,
    declarations: projected.declarations,
    diagnostics: checked.diagnostics.map((diagnostic) => checkDiagnostic(diagnostic, locate)),
    check: checked.info,
  };
}

/** Elaborates a program and, when it checks, generates its Effect TypeScript module. */
export function generateEffectProgram(
  source: string,
  options: EffectProgramOptions = {},
): EffectProgramTypeScript {
  const elaboration = elaborateEffectProgram(source, options);
  if (!elaboration.ok || !elaboration.check) return elaboration;
  const module = generateMechanicsEffectTypeScriptModule(elaboration.declarations, { check: elaboration.check });
  return { ...elaboration, code: module.code, operationNames: module.operationNames };
}

function projectDiagnostic(
  diagnostic: MechanicsArtifactDiagnostic,
  locate: (start: number, end: number) => EffectProgramSpan,
): EffectProgramDiagnostic {
  return {
    phase: "project",
    severity: "error",
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.span ? { span: locate(diagnostic.span.startOffset, diagnostic.span.endOffset) } : {}),
  };
}

function checkDiagnostic(
  diagnostic: MechanicsCheckDiagnostic,
  locate: (start: number, end: number) => EffectProgramSpan,
): EffectProgramDiagnostic {
  return {
    phase: "check",
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.span ? { span: locate(diagnostic.span.startOffset, diagnostic.span.endOffset) } : {}),
  };
}

function lineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/** 1-based line and column of an offset. */
function position(starts: readonly number[], offset: number): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}
