import type {
  AstNode,
  Diagnostic,
  EvaluateResult,
  ExpandResult,
  ParseResult,
  PassName,
  Span,
  TypecheckResult,
} from "@formalang/ts/engine";

export type EnginePassName = PassName;
export type { AstNode, Diagnostic, Span };

export type TimedPassResult =
  | (ParseResult & { readonly durationMs: number })
  | (ExpandResult & { readonly durationMs: number })
  | (TypecheckResult & { readonly durationMs: number })
  | (EvaluateResult & { readonly durationMs: number });

export interface RunRequest {
  readonly id: number;
  readonly sourceId: string;
  readonly source: string;
  readonly passes: readonly EnginePassName[];
}

export interface RunResult {
  readonly id: number;
  readonly sourceId: string;
  readonly passResults: readonly TimedPassResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly stoppedAt?: EnginePassName | undefined;
}

export type WorkerRequest = RunRequest;

export type WorkerResponse =
  | { readonly kind: "result"; readonly result: RunResult }
  | {
      readonly kind: "fatal";
      readonly id: number;
      readonly message: string;
      readonly stack?: string | undefined;
    };

export function hasErrors(result: { readonly diagnostics: readonly Diagnostic[] }): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function serializablePassResult(result: TimedPassResult): TimedPassResult {
  const { env: _env, ...withoutEnv } = result as TimedPassResult & { readonly env?: unknown };
  if (withoutEnv.pass !== "evaluate") return withoutEnv as TimedPassResult;
  return {
    ...withoutEnv,
    value: cloneableValue(withoutEnv.value),
  } as TimedPassResult;
}

export function timeoutRunResult(request: WorkerRequest, timeoutMs: number): RunResult {
  const pass = request.passes.at(-1) ?? "evaluate";
  const diagnostic: Diagnostic = {
    code: "WorkerTimeout",
    severity: "error",
    phase: pass,
    message: `${pass} timed out after ${formatTimeout(timeoutMs)}.`,
    details: { timeoutMs },
  };
  const timed = timeoutPassResult(pass, request.sourceId, diagnostic, timeoutMs);
  return {
    id: request.id,
    sourceId: request.sourceId,
    passResults: [timed],
    diagnostics: [diagnostic],
    stoppedAt: pass,
  };
}

function timeoutPassResult(
  pass: EnginePassName,
  sourceId: string,
  diagnostic: Diagnostic,
  durationMs: number,
): TimedPassResult {
  const base = {
    pass,
    sourceId,
    diagnostics: [diagnostic],
    durationMs,
  };
  switch (pass) {
    case "parse":
    case "expand":
      return { ...base, pass, ast: [] };
    case "typecheck":
      return { ...base, pass, display: "Timed out" };
    case "evaluate":
      return { ...base, pass, value: null, printed: "Evaluation timed out." };
  }
}

function formatTimeout(timeoutMs: number): string {
  if (timeoutMs % 1000 === 0) return `${timeoutMs / 1000} seconds`;
  return `${timeoutMs}ms`;
}

function cloneableValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}
