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
import type { SExpr } from "../reader/types.js";
import { isMechanicsArtifactForm, mechanicsPackageableDeclarations, type MechanicsArtifactDiagnostic } from "./artifact.js";
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

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(source);
  } catch (error) {
    // The lexer throws on characters it cannot read; report them like parse errors.
    const loc = isParseError(error) ? error.loc : undefined;
    return {
      ok: false,
      declarations: [],
      diagnostics: [
        {
          phase: "read",
          severity: "error",
          code: "read/syntax",
          message: (isParseError(error) ? error.message : String(error)).replace(/ at line \d+, column \d+$/, ""),
          ...(loc ? { span: locate(loc.start, loc.end) } : {}),
        },
      ],
    };
  }
  const { redTree, errors } = parsed;
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

  const exprs = toSExprMany(redTree);
  const stray = strayForms(exprs);
  if (stray.length > 0) {
    return {
      ok: false,
      declarations: [],
      diagnostics: stray.map(({ expr, message }) => ({
        phase: "project",
        severity: "error",
        code: "mechanics/top-level-form",
        message,
        span: locate(expr.loc.start, expr.loc.end),
      })),
    };
  }
  const projected = mechanicsPackageableDeclarations(exprs, sourceId);
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

const formUsage: ReadonlyMap<string, string> = new Map([
  ["define-schema", "(define-schema Name SchemaExpr)"],
  ["define-error", "(define-error Name (:fields (field name Type) ...))"],
  ["define-class", "(define-class Name (:fields (field name Type) ...))"],
  ["define-service", "(define-service Name (:methods (method [param Type ...] (Effect A [E...] [R...])) ...))"],
]);

function isParseError(error: unknown): error is { readonly message: string; readonly loc?: { readonly start: number; readonly end: number } } {
  return typeof error === "object" && error !== null && "message" in error;
}

/**
 * Top-level forms an Effect program cannot use. Projection skips anything
 * that is not a mechanics form, which would silently drop a typo'd
 * `define-servce` or a `define` without a signature.
 */
function strayForms(exprs: readonly SExpr[]): readonly { readonly expr: SExpr; readonly message: string }[] {
  const signatures = new Map<string, SExpr>();
  const defined = new Set<string>();
  for (const expr of exprs) {
    if (expr._tag !== "List") continue;
    const head = expr.items[0]?._tag === "Sym" ? expr.items[0].name : undefined;
    const name = expr.items[1]?._tag === "Sym" ? expr.items[1].name : undefined;
    if (head === ":" && name && expr.items.length === 3) signatures.set(name, expr);
    if ((head === "define" || head === "define-operation" || head === "define-layer") && name) defined.add(name);
  }
  const stray: { readonly expr: SExpr; readonly message: string }[] = [];
  for (const expr of exprs) {
    const head = expr._tag === "List" && expr.items[0]?._tag === "Sym" ? expr.items[0].name : undefined;
    const name = expr._tag === "List" && expr.items[1]?._tag === "Sym" ? expr.items[1].name : undefined;
    if (head === ":") {
      if (!name || expr._tag !== "List" || expr.items.length !== 3) {
        stray.push({ expr, message: "A signature is (: name Type)." });
      } else if (!defined.has(name)) {
        stray.push({ expr, message: `The signature for ${name} has no matching define, define-operation, or define-layer.` });
      }
      continue;
    }
    if (head === "define") {
      if (!name || !signatures.has(name)) {
        const subject = name ? `define ${name}` : "define";
        stray.push({ expr, message: `${subject} needs a (: ${name ?? "name"} Type) signature in an Effect program.` });
      } else if (expr._tag === "List" && expr.items.length !== 3) {
        stray.push({ expr, message: `define ${name} expects exactly a name and one value.` });
      }
      continue;
    }
    if (isMechanicsArtifactForm(expr)) continue;
    const usage = head ? formUsage.get(head) : undefined;
    if (usage) {
      stray.push({ expr, message: `${head} is malformed; expected ${usage}.` });
      continue;
    }
    stray.push({
      expr,
      message: head
        ? `${head} is not an Effect program form; expected define-schema, define-error, define-class, define-service, define-operation, define-layer, define, or a (: name Type) signature.`
        : "Top-level expressions are not part of an Effect program; put them in a define or define-operation.",
    });
  }
  return stray;
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
