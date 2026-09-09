import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { diagnosticFromAbi, typeProjection } from "./abi-projections.js";
import { projectInlineValue } from "./value-projections.js";
import type {
  AbortEvaluationRequest,
  AbortEvaluationResult,
  AstNode,
  CallValueRequest,
  CloseSessionRequest,
  CloseSessionResult,
  ConfigureSessionRequest,
  ConfigureSessionResult,
  Diagnostic,
  EditorAnalysisRequest,
  EditorAnalysisResult,
  ExpandRequest,
  ExpandResult,
  EvaluateRequest,
  EvaluationResult,
  EvaluationState,
  ExpressionType,
  LanguageHost,
  LoadSourceBundleRequest,
  LoadSourceBundleResult,
  LoadSourceRequest,
  LoadSourceResult,
  OpenSessionRequest,
  OpenSessionResult,
  ParseRequest,
  ParseResult,
  ProjectValueRequest,
  ProjectValueResult,
  ReleaseValueRequest,
  ReleaseValueResult,
  ResetSessionRequest,
  ResetSessionResult,
  SessionInfoRequest,
  SessionInfoResult,
  TypeProjection,
  TypecheckRequest,
  TypecheckResult,
  ValueProjection,
  VersionResult,
} from "./types.js";

interface AbiResponse {
  readonly ok?: boolean | undefined;
  readonly value?: unknown;
  readonly type?: string | undefined;
  readonly diagnostics?: readonly unknown[] | undefined;
}

type DiagnosticPhase = NonNullable<Diagnostic["phase"]>;

const readProcessEnv = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

const currentWorkingDirectory = (): string =>
  typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";

const defaultJsPath = (): string => {
  try {
    return fileURLToPath(
      new URL("../../ocaml/dist/js/jsoo_entry.cjs", import.meta.url).href,
    );
  } catch {
    return resolve(currentWorkingDirectory(), "packages/ocaml/dist/js/jsoo_entry.cjs");
  }
};

const defaultNodePath = (): string =>
  typeof process !== "undefined" && typeof process.execPath === "string"
    ? process.execPath
    : "node";

export interface JsOcamlLanguageHostOptions {
  readonly jsPath?: string | undefined;
  readonly nodePath?: string | undefined;
}

export class JsOcamlLanguageHost implements LanguageHost {
  readonly name = "ocaml-js";
  readonly #jsPath: string;
  readonly #nodePath: string;

  constructor(options: JsOcamlLanguageHostOptions = {}) {
    this.#jsPath = options.jsPath ?? readProcessEnv("FORMA_OCAML_JS") ?? defaultJsPath();
    this.#nodePath = options.nodePath ?? defaultNodePath();
  }

  async available(): Promise<boolean> {
    return existsSync(this.#jsPath);
  }

  async version(): Promise<VersionResult> {
    const response = await this.request({ op: "version" });
    const value = asRecord(response.value);
    return {
      engine: readString(value, "engine") ?? "forma-ocaml",
      engineVersion: readString(value, "version") ?? "0.0.0",
      hostAbiVersion: "0.1.0",
      capabilities: ["parse", "expand", "typecheck", "evaluate", "projectValue"],
      capabilityNotes: [
        {
          capability: "openSession",
          status: "unsupported",
          detail:
            "Prototype JS OCaml host uses the existing one-shot js_of_ocaml artifact and does not yet keep persistent sessions or retained host-effect continuations alive across requests.",
        },
      ],
    };
  }

  async parse(request: ParseRequest): Promise<ParseResult> {
    const sourceId = request.sourceId ?? "source";
    const response = await this.request({
      op: "parseAst",
      sourceId,
      source: request.source,
    });
    return {
      sourceId,
      ast: Array.isArray(response.value)
        ? response.value.map((value) => astFromOcaml(value, sourceId))
        : [],
      diagnostics: diagnosticsFromResponse(response, "parse"),
    };
  }

  async expand(request: ExpandRequest): Promise<ExpandResult> {
    if (!request.source) {
      return {
        sourceId: request.sourceId ?? "source",
        ast: [],
        diagnostics: [
          unsupportedDiagnostic(
            "session/unsupported",
            "JS OCaml expand requires inline source; persistent source sessions are not supported by the prototype host.",
            "expand",
          ),
        ],
      };
    }
    const sourceId = request.sourceId ?? "source";
    const response = await this.request({
      op: "expand",
      sourceId,
      source: request.source,
    });
    return {
      sourceId,
      ast: Array.isArray(response.value)
        ? response.value.map((value) => astFromOcaml(value, sourceId))
        : [],
      diagnostics: diagnosticsFromResponse(response, "expand"),
    };
  }

  async typecheck(request: TypecheckRequest): Promise<TypecheckResult> {
    if (!request.source) {
      return {
        diagnostics: [
          unsupportedDiagnostic(
            "session/unsupported",
            "JS OCaml typecheck requires inline source; persistent source sessions are not supported by the prototype host.",
            "typecheck",
          ),
        ],
      };
    }
    const response = await this.request({
      op: "typecheck",
      sourceId: request.sourceId ?? "source",
      source: request.source,
      ...(request.result ? { result: request.result } : {}),
      ...(request.typePolicy ? { typePolicy: encodeTypePolicy(request.typePolicy) } : {}),
      ...(request.hostBuiltins ? { hostBuiltins: request.hostBuiltins } : {}),
    });
    const value = asRecord(response.value);
    const display = readString(value, "display") ?? response.type;
    const projectedType = typeProjectionFromAbi(value["type"], display);
    return {
      ...(display ? { display } : {}),
      ...(projectedType ? { type: projectedType } : {}),
      diagnostics: diagnosticsFromResponse(response, "typecheck"),
      ...(Array.isArray(value["expressionTypes"])
        ? { expressionTypes: value["expressionTypes"].map((item) => expressionTypeFromAbi(item)) }
        : request.result === "per-expression"
          ? { expressionTypes: [] }
          : {}),
    };
  }

  async evaluate(request: EvaluateRequest): Promise<EvaluationResult> {
    const response = await this.request({
      op: "evaluate",
      sourceId: request.sourceId ?? "source",
      source: request.source,
    });
    const value = valueFromOcaml(response.value);
    return {
      value,
      diagnostics: diagnosticsFromResponse(response, "evaluate"),
    };
  }

  async projectValue(request: ProjectValueRequest): Promise<ProjectValueResult> {
    if (request.valueRef) {
      return {
        value: { kind: "nil" },
        diagnostics: [
          unsupportedDiagnostic(
            "value-ref/unsupported",
            "JS OCaml prototype host does not retain value references.",
            "evaluate",
          ),
        ],
      };
    }
    return {
      ...projectInlineValue(request.value ?? { kind: "nil" }, request.projections),
      diagnostics: [],
    };
  }

  async openSession(_request: OpenSessionRequest = {}): Promise<OpenSessionResult> {
    throw new Error(
      "JS OCaml prototype host does not support persistent sessions; use NodeOcamlLanguageHost for native session coverage or add a persistent JS runtime adapter.",
    );
  }

  async configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult> {
    return {
      sessionId: request.sessionId,
      bindingCount: 0,
      builtinCount: 0,
    };
  }

  async loadSource(request: LoadSourceRequest): Promise<LoadSourceResult> {
    return {
      sourceId: request.sourceId,
      formCount: 0,
      diagnostics: [
        unsupportedDiagnostic(
          "session/unsupported",
          "JS OCaml prototype host does not support persistent source sessions.",
          "parse",
        ),
      ],
    };
  }

  async loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult> {
    return {
      sources: request.sources.map((source) => ({
        sourceId: source.sourceId,
        formCount: 0,
        diagnostics: [
          unsupportedDiagnostic(
            "session/unsupported",
            "JS OCaml prototype host does not support persistent source sessions.",
            "parse",
          ),
        ],
      })),
      diagnostics: [
        unsupportedDiagnostic(
          "session/unsupported",
          "JS OCaml prototype host does not support persistent source sessions.",
          "parse",
        ),
      ],
    };
  }

  async evaluateInSession(_request: { readonly sessionId: string }): Promise<EvaluationState> {
    return unsupportedEvaluation(
      "session/unsupported",
      "JS OCaml prototype host does not support persistent session evaluation.",
    );
  }

  async callValue(_request: CallValueRequest): Promise<EvaluationState> {
    return unsupportedEvaluation(
      "value-ref/unsupported",
      "JS OCaml prototype host does not retain callable values.",
    );
  }

  async resumeHostCall(_request: { readonly sessionId: string }): Promise<EvaluationState> {
    return unsupportedEvaluation(
      "host-effect/unsupported",
      "JS OCaml prototype host does not retain host-effect continuations.",
    );
  }

  async abortEvaluation(request: AbortEvaluationRequest): Promise<AbortEvaluationResult> {
    return {
      evaluationId: request.evaluationId,
      aborted: false,
    };
  }

  async releaseValue(_request: ReleaseValueRequest): Promise<ReleaseValueResult> {
    return { released: [] };
  }

  async analyzeEditor(request: EditorAnalysisRequest): Promise<EditorAnalysisResult> {
    const sourceId = request.sourceId ?? "source";
    const diagnostic = unsupportedDiagnostic(
      "editor/unsupported",
      "JS OCaml editor analysis is not exposed through LanguageHost yet; use parse/typecheck projections or the TS editor adapter.",
      "typecheck",
    );
    return {
      sourceId,
      success: false,
      typedSpans: [],
      errors: [{ message: diagnostic.message, code: diagnostic.code }],
      diagnostics: [diagnostic],
      parse: {
        errors: [],
        greenTree: null,
        redTree: null,
      },
    };
  }

  async sessionInfo(request: SessionInfoRequest): Promise<SessionInfoResult> {
    return {
      sessionId: request.sessionId,
      sourceCount: 0,
      preludeCount: 0,
      sources: [],
      preludes: [],
      diagnostics: [
        unsupportedDiagnostic(
          "session/unsupported",
          "JS OCaml prototype host does not support persistent session metadata.",
          "evaluate",
        ),
      ],
    };
  }

  async resetSession(request: ResetSessionRequest): Promise<ResetSessionResult> {
    return {
      sessionId: request.sessionId,
      reset: false,
      diagnostics: [
        unsupportedDiagnostic(
          "session/unsupported",
          "JS OCaml prototype host does not support persistent session reset.",
          "evaluate",
        ),
      ],
    };
  }

  async closeSession(request: CloseSessionRequest): Promise<CloseSessionResult> {
    return { sessionId: request.sessionId, closed: false };
  }

  private async request(payload: Record<string, unknown>): Promise<AbiResponse> {
    if (!existsSync(this.#jsPath)) {
      throw new Error(
        `Missing OCaml JS language artifact at ${this.#jsPath}. Build it with \`pnpm --filter @formalang/ocaml build\`.`,
      );
    }
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(this.#nodePath, [this.#jsPath, JSON.stringify(payload)], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolveOutput(stdout);
          return;
        }
        reject(
          new Error(
            `OCaml JS ABI request failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      });
    });
    return JSON.parse(output) as AbiResponse;
  }
}

function unsupportedEvaluation(code: string, message: string): EvaluationState {
  return {
    status: "failed",
    diagnostics: [unsupportedDiagnostic(code, message, "evaluate")],
  };
}

function unsupportedDiagnostic(code: string, message: string, phase: DiagnosticPhase): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    phase,
  };
}

function diagnosticsFromResponse(
  response: AbiResponse,
  phase: DiagnosticPhase,
): readonly Diagnostic[] {
  if (!Array.isArray(response.diagnostics)) return [];
  return response.diagnostics.map((diagnostic) => diagnosticFromAbi(diagnostic, phase));
}

function astFromOcaml(value: unknown, fallbackSourceId: string): AstNode {
  const record = asRecord(value);
  const kind = readString(record, "kind");
  const span = spanFromOcaml(record["span"], fallbackSourceId);
  switch (kind) {
    case "nil":
      return { kind: "nil", ...(span ? { span } : {}) };
    case "bool":
      return { kind: "bool", value: record["value"] === true, ...(span ? { span } : {}) };
    case "int":
    case "float":
      return {
        kind,
        value: typeof record["value"] === "number" ? record["value"] : 0,
        ...(span ? { span } : {}),
      };
    case "string":
    case "symbol":
    case "keyword":
      return {
        kind,
        value: typeof record["value"] === "string" ? record["value"] : "",
        ...(span ? { span } : {}),
      };
    case "list":
    case "vector":
      return {
        kind,
        items: Array.isArray(record["items"])
          ? record["items"].map((item) => astFromOcaml(item, fallbackSourceId))
          : [],
        ...(span ? { span } : {}),
      };
    case "map":
      return {
        kind: "map",
        entries: Array.isArray(record["entries"])
          ? record["entries"].map((entry) => {
              const pair = asRecord(entry);
              return {
                key: astFromOcaml(pair["key"], fallbackSourceId),
                value: astFromOcaml(pair["value"], fallbackSourceId),
              };
            })
          : [],
        ...(span ? { span } : {}),
      };
    default:
      return {
        kind: "error",
        message: `Unsupported OCaml AST node: ${JSON.stringify(value)}`,
        ...(span ? { span } : {}),
      };
  }
}

function valueFromOcaml(value: unknown): ValueProjection {
  const record = asRecord(value);
  const kind = readString(record, "kind");
  switch (kind) {
    case "nil":
      return { kind: "nil" };
    case "bool":
      return { kind: "bool", value: record["value"] === true };
    case "int":
    case "float":
      return { kind, value: typeof record["value"] === "number" ? record["value"] : 0 };
    case "string":
    case "symbol":
    case "keyword":
      return { kind, value: typeof record["value"] === "string" ? record["value"] : "" };
    case "list":
    case "vector":
      return {
        kind,
        items: Array.isArray(record["items"]) ? record["items"].map(valueFromOcaml) : [],
      };
    case "map":
      return {
        kind: "map",
        entries: Array.isArray(record["entries"])
          ? record["entries"].map((entry) => {
              const pair = asRecord(entry);
              return {
                key: valueFromOcaml(pair["key"]),
                value: valueFromOcaml(pair["value"]),
              };
            })
          : [],
      };
    case "function":
      if (typeof record["valueRef"] === "string") {
        return { kind: "function", valueRef: record["valueRef"], display: "<function>" };
      }
      return { kind: "opaque", tag: "function", display: "<function>" };
    default:
      if (value === null || value === undefined) return { kind: "nil" };
      if (typeof value === "boolean") return { kind: "bool", value };
      if (typeof value === "number") {
        return Number.isInteger(value) ? { kind: "int", value } : { kind: "float", value };
      }
      if (typeof value === "string") return { kind: "string", value };
      return { kind: "opaque", tag: "ocaml-js-value", display: JSON.stringify(value) };
  }
}

function typeProjectionFromAbi(
  value: unknown,
  fallbackDisplay: string | undefined,
): TypeProjection | undefined {
  const record = asRecord(value);
  const kind = readString(record, "kind");
  if (kind === "named") {
    const name = readString(record, "name");
    const display = readString(record, "display") ?? fallbackDisplay;
    if (name && display) return { kind: "named", name, display };
  }
  if (kind === "display") {
    const display = readString(record, "display") ?? fallbackDisplay;
    if (display) return { kind: "display", display };
  }
  return fallbackDisplay ? typeProjection(fallbackDisplay) : undefined;
}

function expressionTypeFromAbi(value: unknown): ExpressionType {
  const record = asRecord(value);
  const display = readString(record, "display") ?? "Unknown";
  const span = spanFromOcaml(record["span"], "source");
  return {
    expressionId: readString(record, "expressionId") ?? "expression",
    formIndex: readNumber(record, "formIndex") ?? 0,
    ...(span ? { span } : {}),
    display,
    type: typeProjectionFromAbi(record["type"], display) ?? typeProjection(display),
  };
}

function spanFromOcaml(value: unknown, fallbackSourceId: string) {
  const record = asRecord(value);
  const startOffset = readNumber(record, "startOffset");
  const endOffset = readNumber(record, "endOffset");
  if (startOffset === undefined || endOffset === undefined) return undefined;
  return {
    sourceId: readString(record, "sourceId") ?? fallbackSourceId,
    startOffset,
    endOffset,
  };
}

function encodeTypePolicy(policy: NonNullable<TypecheckRequest["typePolicy"]>) {
  return {
    ...(policy.defaultBuiltinScheme ? { defaultBuiltinScheme: policy.defaultBuiltinScheme } : {}),
    ...(policy.unboundSymbols
      ? {
          unboundSymbols: policy.unboundSymbols.map((entry) => ({
            match: entry.match,
            type: entry.type,
            ...(entry.reason ? { reason: entry.reason } : {}),
          })),
        }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}
