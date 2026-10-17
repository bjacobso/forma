import { Effect } from "effect";
import { typecheck, type Diagnostic } from "@formalang/ts/engine";
import {
  generateEffectProgram,
  generateMechanicsEffectTypeScriptModule,
  mechanicsPackageableDeclarations,
  type EffectProgramDiagnostic,
} from "@formalang/ts/mechanics";
import {
  checkModuleGraph,
  ModuleError,
  resolveModuleGraph,
  sourceModuleResolver,
} from "@formalang/ts/modules";
import { parseManyToSExpr } from "@formalang/ts/reader";
import { schemaDeclarationsJson } from "./pipelines/canonicalIr";
import {
  composeAgentsSource,
  composeSupportBrokenSource,
  composeToolsSource,
  contractSource,
  defineEntityDescriptor,
  entitySchemaSource,
  undeclaredCapabilitySource,
} from "./pipelines/sources";

/** Directory, relative to the repository root, that the docs homepage imports. */
export const homeSnippetDir = "docs/snippets/home";

/**
 * Every code sample on the docs homepage, keyed by file name. Each one is a
 * checked-in source or real engine output, so the homepage cannot drift from
 * what the compiler does. Regenerate with
 * `pnpm --filter @formalang/website snippets:home`.
 */
export function homeSnippets(): Record<string, string> {
  return {
    "entities.lisp": entitySchemaSource,
    "entities.ir.json": schemaDeclarationsJson(),
    "define-entity.lisp": `${defineEntityDescriptor}\n`,
    "log.lisp": `${contractSource}\n`,
    "log.type.txt": `${inferredContract(contractSource)}\n`,
    "log.ts": effectTypeScript(contractSource, "log.lisp"),
    "log-undeclared.lisp": `${undeclaredCapabilitySource}\n`,
    "log-undeclared.diagnostic.json": `${JSON.stringify(
      typecheckDiagnostic(undeclaredCapabilitySource, "log.lisp"),
      null,
      2,
    )}\n`,
    "log-undeclared.check.json": `${JSON.stringify(
      effectCheckDiagnostic(undeclaredCapabilitySource, "log.forma"),
      null,
      2,
    )}\n`,
    "compose-tools.lisp": composeToolsSource,
    "compose-agents.lisp": composeAgentsSource,
    "compose-support.lisp": composeSupportBrokenSource,
    "compose-support.diagnostic.json": `${JSON.stringify(
      moduleGraphDiagnostic(composeSupportBrokenSource),
      null,
      2,
    )}\n`,
  };
}

/** The diagnostic the live Effect checker reports, as the homepage embed shows it. */
export function effectCheckDiagnostic(source: string, sourceId: string): EffectProgramDiagnostic {
  const [diagnostic] = generateEffectProgram(source, { sourceId }).diagnostics;
  if (!diagnostic) throw new Error(`${sourceId} checked without diagnostics`);
  return diagnostic;
}

/** Diagnostics from checking `support.forma` against the two composed preludes. */
export function moduleGraphDiagnostics(support: string): readonly Diagnostic[] {
  const sources = [
    { id: "tools.forma", source: composeToolsSource },
    { id: "agents.forma", source: composeAgentsSource },
    { id: "support.forma", source: support },
  ];
  try {
    const graph = resolveModuleGraph(sources[2]!, sourceModuleResolver(sources));
    return checkModuleGraph(graph).diagnostics;
  } catch (error) {
    if (error instanceof ModuleError) return [error.diagnostic];
    throw error;
  }
}

function moduleGraphDiagnostic(support: string): Diagnostic {
  const [diagnostic] = moduleGraphDiagnostics(support);
  if (!diagnostic) throw new Error("support.forma checked without diagnostics");
  return diagnostic;
}

/** 1-based inclusive line range covered by a diagnostic span. */
export function spanLines(source: string, diagnostic: Diagnostic): readonly [number, number] {
  const lineAt = (offset: number) => source.slice(0, offset).split("\n").length;
  const span = diagnostic.span!;
  return [lineAt(span.startOffset), lineAt(Math.max(span.startOffset, span.endOffset - 1))];
}

export function typecheckDiagnostic(source: string, sourceId: string): Diagnostic {
  const result = typecheck({ sourceId, source });
  const [diagnostic] = result.diagnostics;
  if (!diagnostic) throw new Error(`${sourceId} typechecked without diagnostics`);
  return diagnostic;
}

function inferredContract(source: string): string {
  const result = typecheck({ sourceId: "log.lisp", source });
  if (result.diagnostics.length > 0 || !result.display) {
    throw new Error(`log.lisp failed to typecheck: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.display;
}

function effectTypeScript(source: string, sourceId: string): string {
  const forms = Effect.runSync(parseManyToSExpr(source));
  const result = mechanicsPackageableDeclarations(forms, sourceId);
  if (!result.ok) {
    throw new Error(`${sourceId} did not project: ${JSON.stringify(result.diagnostics)}`);
  }
  return generateMechanicsEffectTypeScriptModule(result.declarations).code;
}

export { elmPageSnippets, elmSnippetDir } from "./elmPageSnippets";
