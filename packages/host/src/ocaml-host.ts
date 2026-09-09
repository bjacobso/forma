import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { diagnosticFromAbi, typeProjection } from "./abi-projections.js";
import { printProjectedValue, projectInlineValue } from "./value-projections.js";
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
  EvaluateInSessionRequest,
  EvaluateRequest,
  EvaluationResult,
  EvaluationState,
  ExpressionType,
  HostBuiltinDescriptor,
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
  ResumeHostCallRequest,
  SessionVariable,
  SessionInfoRequest,
  SessionInfoResult,
  SessionSourceInfo,
  TypeProjection,
  TypePolicy,
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

interface OcamlSessionConfig {
  hostBuiltins: readonly HostBuiltinDescriptor[];
  typePolicy?: TypePolicy | undefined;
  variables: readonly SessionVariable[];
}

interface OcamlRetainedValue {
  readonly value: ValueProjection;
  readonly callSource?: string | undefined;
}

const readProcessEnv = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

const readPositiveNumberEnv = (name: string): number | undefined => {
  const value = Number(readProcessEnv(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const currentWorkingDirectory = (): string =>
  typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";

const defaultCliPath = (): string => {
  try {
    return fileURLToPath(
      new URL("../../ocaml/dist/native/forma_cli.exe", import.meta.url).href,
    );
  } catch {
    return resolve(
      currentWorkingDirectory(),
      "packages/ocaml/dist/native/forma_cli.exe",
    );
  }
};

export interface NodeOcamlLanguageHostOptions {
  readonly cliPath?: string | undefined;
  readonly daemonRequestTimeoutMs?: number | undefined;
}

export class NodeOcamlLanguageHost implements LanguageHost {
  readonly name = "ocaml-native";
  readonly #cliPath: string;
  readonly #daemonRequestTimeoutMs: number;
  #daemon:
    | {
        readonly child: ChildProcessWithoutNullStreams;
        readonly lines: ReadlineInterface;
        readonly responses: string[];
        readonly waiters: ((line: string) => void)[];
        stderr: string;
      }
    | undefined;
  #openSessions = 0;
  #nextValueRefId = 1;
  readonly #sessionConfigs = new Map<string, OcamlSessionConfig>();
  readonly #sessionValueRefs = new Map<string, Map<string, OcamlRetainedValue>>();
  readonly #activeEvaluations = new Map<string, { readonly sessionId: string }>();

  constructor(options: NodeOcamlLanguageHostOptions = {}) {
    this.#cliPath =
      options.cliPath ?? readProcessEnv("FORMA_OCAML_CLI") ?? defaultCliPath();
    this.#daemonRequestTimeoutMs =
      options.daemonRequestTimeoutMs ?? readPositiveNumberEnv("FORMA_DAEMON_TIMEOUT_MS") ?? 30_000;
  }

  async version(): Promise<VersionResult> {
    const response = await this.request({ op: "version" });
    const value = asRecord(response.value);
    return {
      engine: readString(value, "engine") ?? "forma-ocaml",
      engineVersion: readString(value, "version") ?? "0.0.0",
      hostAbiVersion: "0.1.0",
      capabilities: [
        "parse",
        "expand",
        "typecheck",
        "evaluate",
        "openSession",
        "configureSession",
        "loadSource",
        "loadSourceBundle",
        "evaluateInSession",
        "resumeHostCall",
        "abortEvaluation",
        "projectValue",
        "releaseValue",
        "sessionInfo",
        "resetSession",
        "closeSession",
      ],
      capabilityNotes: [
        {
          capability: "abortEvaluation",
          status: "partial",
          detail:
            "Releases retained native continuations and can destructively kill active daemon requests for caller-supplied evaluation ids; does not cooperatively interrupt currently running native evaluation.",
        },
      ],
    };
  }

  async openSession(_request: OpenSessionRequest = {}): Promise<OpenSessionResult> {
    const response = await this.sessionRequest({ op: "openSession" });
    throwIfAbiFailed(response, "OCaml openSession failed");
    const value = asRecord(response.value);
    const sessionId = readString(value, "sessionId");
    if (!sessionId) {
      throw new Error("OCaml openSession response did not include sessionId");
    }
    this.#openSessions += 1;
    this.#sessionConfigs.set(sessionId, {
      hostBuiltins: [],
      variables: [],
    });
    this.#sessionValueRefs.set(sessionId, new Map());
    return { sessionId };
  }

  async configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult> {
    const current = this.#requireSessionConfig(request.sessionId);
    const variables = request.variables ?? current.variables;
    const hostBuiltins = request.hostBuiltins ?? current.hostBuiltins;
    const typePolicy = request.typePolicy ?? current.typePolicy;

    if (request.variables) {
      for (const variable of request.variables) {
        const response = await this.sessionRequest({
          op: "replSubmit",
          sessionId: request.sessionId,
          source: variableDefinitionSource(variable),
        });
        const diagnostics = diagnosticsFromResponse(response, "evaluate");
        if (
          response.ok === false ||
          diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ) {
          throw new Error(
            `OCaml configureSession failed for ${variable.name}: ${diagnostics
              .map((diagnostic) => diagnostic.message)
              .join("; ")}`,
          );
        }
      }
    }

    this.#sessionConfigs.set(request.sessionId, {
      hostBuiltins,
      variables,
      ...(typePolicy ? { typePolicy } : {}),
    });

    return {
      sessionId: request.sessionId,
      bindingCount: request.variables?.length ?? 0,
      builtinCount: hostBuiltins.length,
    };
  }

  async loadSource(request: LoadSourceRequest): Promise<LoadSourceResult> {
    const response = await this.sessionRequest({
      op: "loadSource",
      sessionId: request.sessionId,
      kind: request.kind ?? "source",
      sourceId: request.sourceId,
      source: request.source,
    });
    const value = asRecord(response.value);
    return {
      sourceId: readString(value, "id") ?? request.sourceId,
      formCount: readNumber(value, "formCount") ?? 0,
      diagnostics: diagnosticsFromResponse(response, "parse"),
    };
  }

  async loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult> {
    const response = await this.sessionRequest({
      op: "loadSourceBundle",
      sessionId: request.sessionId,
      sources: request.sources.map((source) => ({
        kind: source.kind ?? "source",
        sourceId: source.sourceId,
        source: source.source,
      })),
    });
    const value = asRecord(response.value);
    const results = Array.isArray(value["results"]) ? value["results"] : [];
    return {
      sources: results.map((item, index): LoadSourceResult => {
        const result = asRecord(item);
        return {
          sourceId: readString(result, "sourceId") ?? request.sources[index]?.sourceId ?? "source",
          formCount: readNumber(result, "formCount") ?? 0,
          diagnostics: Array.isArray(result["diagnostics"])
            ? result["diagnostics"].map((diagnostic) => diagnosticFromAbi(diagnostic, "parse"))
            : [],
        };
      }),
      diagnostics: diagnosticsFromResponse(response, "parse"),
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
    const sourceId = request.sourceId ?? "source";
    const payload = {
      op: "expand",
      sourceId,
      ...(request.source ? { source: request.source } : {}),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    };
    const response = await (request.sessionId
      ? this.sessionRequest(payload)
      : this.request(payload));
    return {
      sourceId,
      ast: Array.isArray(response.value)
        ? response.value.map((value) => astFromOcaml(value, sourceId))
        : [],
      diagnostics: diagnosticsFromResponse(response, "expand"),
    };
  }

  async typecheck(request: TypecheckRequest): Promise<TypecheckResult> {
    const sessionConfig = request.sessionId
      ? this.#sessionConfigs.get(request.sessionId)
      : undefined;
    const useSession = request.sessionId !== undefined;
    const payload = {
      op: "typecheck",
      sourceId: request.sourceId ?? "source",
      ...(request.source ? { source: request.source } : {}),
      ...(useSession ? { sessionId: request.sessionId } : {}),
      ...(request.result ? { result: request.result } : {}),
      ...((request.typePolicy ?? sessionConfig?.typePolicy)
        ? { typePolicy: encodeTypePolicy((request.typePolicy ?? sessionConfig?.typePolicy)!) }
        : {}),
      ...((request.hostBuiltins ?? sessionConfig?.hostBuiltins)
        ? { hostBuiltins: request.hostBuiltins ?? sessionConfig?.hostBuiltins }
        : {}),
    };
    const response = await (useSession ? this.sessionRequest(payload) : this.request(payload));
    const value = asRecord(response.value);
    const display = readString(value, "display") ?? response.type;
    const projectedType = typeProjectionFromAbi(value["type"], display);
    const diagnostics = diagnosticsFromResponse(response, "typecheck");
    return {
      ...(display ? { display } : {}),
      ...(projectedType ? { type: projectedType } : {}),
      diagnostics,
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
    return {
      value: valueFromOcaml(response.value),
      diagnostics: diagnosticsFromResponse(response, "evaluate"),
    };
  }

  async evaluateInSession(request: EvaluateInSessionRequest): Promise<EvaluationState> {
    if (!request.source) {
      const finishActiveEvaluation = this.#beginActiveEvaluation(request);
      const response = await this.sessionRequest({
        op: "evaluate",
        sessionId: request.sessionId,
        ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      }).finally(finishActiveEvaluation);
      const diagnostics = diagnosticsFromResponse(response, "evaluate");
      if (diagnostics.length > 0 || response.ok === false) {
        return { status: "failed", diagnostics };
      }
      const value = this.#projectSessionValue(
        request.sessionId,
        valueFromOcaml(response.value),
        request.retainValues,
        undefined,
      );
      return {
        status: "completed",
        result: {
          value,
          diagnostics,
        },
      };
    }

    const finishActiveEvaluation = this.#beginActiveEvaluation(request);
    const response = await this.sessionRequest({
      op: "replSubmit",
      sessionId: request.sessionId,
      ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      source: request.source,
      ...(this.#requireSessionConfig(request.sessionId).hostBuiltins.length > 0
        ? { hostBuiltins: this.#requireSessionConfig(request.sessionId).hostBuiltins }
        : {}),
    }).finally(finishActiveEvaluation);
    const diagnostics = diagnosticsFromResponse(response, "evaluate");
    if (diagnostics.length > 0 || response.ok === false) {
      return { status: "failed", diagnostics };
    }
    const value = asRecord(response.value);
    const state = this.#stateFromNativeSessionValue(request.sessionId, value, request);
    if (state) return state;
    const projected = this.#projectSessionValue(
      request.sessionId,
      valueFromOcaml(value["value"]),
      request.retainValues,
      request.source,
    );
    return {
      status: "completed",
      result: {
        value: projected,
        ...(readNumber(value, "formCount") !== undefined
          ? { steps: readNumber(value, "formCount") }
          : {}),
        diagnostics,
      },
    };
  }

  async callValue(request: CallValueRequest): Promise<EvaluationState> {
    const retained = this.#sessionValueRefs.get(request.sessionId)?.get(request.valueRef);
    if (!retained && request.valueRef.startsWith("ocaml-native-value-")) {
      const finishActiveEvaluation = this.#beginActiveEvaluation(request);
      const response = await this.sessionRequest({
        op: "callValue",
        sessionId: request.sessionId,
        valueRef: request.valueRef,
        args: request.args,
      }).finally(finishActiveEvaluation);
      const diagnostics = diagnosticsFromResponse(response, "evaluate");
      if (diagnostics.length > 0 || response.ok === false) {
        return { status: "failed", diagnostics };
      }
      const value = asRecord(response.value);
      const state = this.#stateFromNativeSessionValue(request.sessionId, value, request);
      if (state) return state;
      return unsupportedEvaluation(
        "value-ref/invalid-response",
        "OCaml callValue did not return an evaluation state",
      );
    }
    if (!retained) {
      return unsupportedEvaluation("value-ref/not-found", "No retained OCaml value found to call");
    }
    if (!retained.callSource) {
      return unsupportedEvaluation(
        "value-ref/unsupported",
        "Retained OCaml value does not have a callable source expression",
      );
    }
    return this.evaluateInSession({
      sessionId: request.sessionId,
      evaluationId: request.evaluationId,
      source: `(${retained.callSource} ${request.args.map(printProjectedValue).join(" ")})`,
      stepLimit: request.stepLimit,
      resultProjection: request.resultProjection,
      retainValues: request.retainValues,
    });
  }

  async resumeHostCall(request: ResumeHostCallRequest): Promise<EvaluationState> {
    const firstFailure = request.result.ok ? undefined : request.result.diagnostics[0];
    const response = await this.sessionRequest({
      op: "resumeHostCall",
      sessionId: request.sessionId,
      evaluationId: request.evaluationId,
      callId: request.callId,
      resumeOk: request.result.ok,
      ...(request.result.ok ? { value: request.result.value } : {}),
      ...(!request.result.ok && firstFailure?.code ? { failureCode: firstFailure.code } : {}),
      ...(!request.result.ok && firstFailure?.message
        ? { failureMessage: firstFailure.message }
        : {}),
    });
    const diagnostics = diagnosticsFromResponse(response, "evaluate");
    if (diagnostics.length > 0 || response.ok === false) {
      return { status: "failed", diagnostics };
    }
    const value = asRecord(response.value);
    const state = this.#stateFromNativeSessionValue(request.sessionId, value, {});
    if (state) return state;
    return unsupportedEvaluation(
      "host-effect/invalid-response",
      "OCaml resumeHostCall did not return an evaluation state",
    );
  }

  async abortEvaluation(request: AbortEvaluationRequest): Promise<AbortEvaluationResult> {
    if (this.#abortActiveEvaluation(request)) {
      return {
        evaluationId: request.evaluationId,
        aborted: true,
      };
    }

    const response = await this.sessionRequest({
      op: "abortEvaluation",
      sessionId: request.sessionId,
      evaluationId: request.evaluationId,
    });
    const value = asRecord(response.value);
    return {
      evaluationId: readString(value, "evaluationId") ?? request.evaluationId,
      aborted: value["aborted"] === true,
    };
  }

  async projectValue(request: ProjectValueRequest): Promise<ProjectValueResult> {
    if (request.valueRef) {
      if (!request.sessionId) {
        return {
          value: { kind: "nil" },
          diagnostics: [
            {
              code: "session/required",
              severity: "error",
              message: "Projecting a retained OCaml value requires a sessionId",
              phase: "evaluate",
            },
          ],
        };
      }
      const retained = this.#sessionValueRefs.get(request.sessionId)?.get(request.valueRef);
      if (retained) {
        return {
          ...projectInlineValue(
            { ...retained.value, valueRef: request.valueRef },
            request.projections,
          ),
          diagnostics: [],
        };
      }
      return {
        value: { kind: "nil" },
        diagnostics: [
          {
            code: "value-ref/not-found",
            severity: "error",
            message: "No retained OCaml value found to project",
            phase: "evaluate",
          },
        ],
      };
    }
    return {
      ...projectInlineValue(request.value ?? { kind: "nil" }, request.projections),
      diagnostics: [],
    };
  }

  async releaseValue(request: ReleaseValueRequest): Promise<ReleaseValueResult> {
    const retained = this.#sessionValueRefs.get(request.sessionId);
    const released: string[] = [];
    if (retained) {
      for (const valueRef of request.valueRefs) {
        if (retained.delete(valueRef)) {
          released.push(valueRef);
        }
      }
    }
    const nativeValueRefs = request.valueRefs.filter((valueRef) =>
      valueRef.startsWith("ocaml-native-value-"),
    );
    if (nativeValueRefs.length > 0) {
      const response = await this.sessionRequest({
        op: "releaseValue",
        sessionId: request.sessionId,
        valueRefs: nativeValueRefs,
      });
      const value = asRecord(response.value);
      const nativeReleased = Array.isArray(value["released"])
        ? value["released"].filter((valueRef): valueRef is string => typeof valueRef === "string")
        : [];
      released.push(...nativeReleased);
    }
    return { released };
  }

  async analyzeEditor(request: EditorAnalysisRequest): Promise<EditorAnalysisResult> {
    const sourceId = request.sourceId ?? "source";
    const diagnostic: Diagnostic = {
      code: "editor/unsupported",
      severity: "error",
      message:
        "Native OCaml editor analysis is not exposed through LanguageHost yet; use parse/typecheck projections or the TS editor adapter.",
      phase: "typecheck",
      span: {
        sourceId,
        startOffset: 0,
        endOffset: 0,
      },
    };
    return {
      sourceId,
      success: false,
      typedSpans: [],
      errors: [{ message: diagnostic.message, span: diagnostic.span, code: diagnostic.code }],
      diagnostics: [diagnostic],
      parse: {
        errors: [],
        greenTree: null,
        redTree: null,
      },
    };
  }

  async sessionInfo(request: SessionInfoRequest): Promise<SessionInfoResult> {
    this.#requireSessionConfig(request.sessionId);
    const [sessionResponse, sourceResponse] = await Promise.all([
      this.sessionRequest({ op: "sessionInfo", sessionId: request.sessionId }),
      this.sessionRequest({ op: "sourceSummary", sessionId: request.sessionId }),
    ]);
    const session = asRecord(sessionResponse.value);
    const source = asRecord(sourceResponse.value);
    return {
      sessionId: request.sessionId,
      sourceCount: readNumber(source, "sourceCount") ?? readNumber(session, "sourceCount") ?? 0,
      preludeCount: readNumber(source, "preludeCount") ?? readNumber(session, "preludeCount") ?? 0,
      sources: sessionSourceInfos(source["sources"]),
      preludes: sessionSourceInfos(source["preludes"]),
      ...(readNumber(session, "parsedSourceCount") !== undefined
        ? { parsedSourceCount: readNumber(session, "parsedSourceCount") }
        : {}),
      ...(readNumber(session, "parsedPreludeCount") !== undefined
        ? { parsedPreludeCount: readNumber(session, "parsedPreludeCount") }
        : {}),
      ...(readNumber(session, "envBindingCount") !== undefined
        ? { envBindingCount: readNumber(session, "envBindingCount") }
        : {}),
      ...(readNumber(session, "typeBindingCount") !== undefined
        ? { typeBindingCount: readNumber(session, "typeBindingCount") }
        : {}),
      diagnostics: [
        ...diagnosticsFromResponse(sessionResponse, "evaluate"),
        ...diagnosticsFromResponse(sourceResponse, "evaluate"),
      ],
    };
  }

  async resetSession(request: ResetSessionRequest): Promise<ResetSessionResult> {
    this.#requireSessionConfig(request.sessionId);
    const response = await this.sessionRequest({
      op: "resetSession",
      sessionId: request.sessionId,
    });
    this.#sessionConfigs.set(request.sessionId, {
      hostBuiltins: [],
      variables: [],
    });
    this.#sessionValueRefs.set(request.sessionId, new Map());
    for (const [key, value] of this.#activeEvaluations) {
      if (value.sessionId === request.sessionId) this.#activeEvaluations.delete(key);
    }
    const diagnostics = diagnosticsFromResponse(response, "evaluate");
    return {
      sessionId: request.sessionId,
      reset: response.ok !== false && diagnostics.length === 0,
      diagnostics,
    };
  }

  async closeSession(request: CloseSessionRequest): Promise<CloseSessionResult> {
    await this.sessionRequest({ op: "closeSession", sessionId: request.sessionId });
    this.#sessionConfigs.delete(request.sessionId);
    this.#sessionValueRefs.delete(request.sessionId);
    this.#openSessions = Math.max(0, this.#openSessions - 1);
    if (this.#openSessions === 0) {
      this.closeDaemon();
    }
    return { sessionId: request.sessionId, closed: true };
  }

  #beginActiveEvaluation(request: {
    readonly sessionId: string;
    readonly evaluationId?: string | undefined;
  }): () => void {
    if (!request.evaluationId) return () => {};
    const key = this.#activeEvaluationKey(request.sessionId, request.evaluationId);
    this.#activeEvaluations.set(key, { sessionId: request.sessionId });
    return () => {
      this.#activeEvaluations.delete(key);
    };
  }

  #abortActiveEvaluation(request: AbortEvaluationRequest): boolean {
    const key = this.#activeEvaluationKey(request.sessionId, request.evaluationId);
    if (!this.#activeEvaluations.has(key)) return false;
    this.#activeEvaluations.delete(key);
    this.closeDaemon();
    this.#invalidateNativeSessions();
    return true;
  }

  #activeEvaluationKey(sessionId: string, evaluationId: string): string {
    return `${sessionId}\u0000${evaluationId}`;
  }

  #invalidateNativeSessions(): void {
    this.#sessionConfigs.clear();
    this.#sessionValueRefs.clear();
    this.#activeEvaluations.clear();
    this.#openSessions = 0;
  }

  #projectSessionValue(
    sessionId: string,
    value: ValueProjection,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
    callSource: string | undefined,
  ): ValueProjection {
    if (isOcamlFunctionValue(value)) {
      if (retainValues === "functions" || retainValues === "all") {
        const valueRef = this.#retainProjectedValue(sessionId, value, callSource).valueRef;
        return { kind: "function", valueRef, display: "<function>" };
      }
      return value;
    }
    if (retainValues !== "all") return value;
    return this.#retainProjectedValue(sessionId, value, undefined);
  }

  #stateFromNativeSessionValue(
    sessionId: string,
    value: Record<string, unknown>,
    request: Pick<EvaluateInSessionRequest, "retainValues">,
  ): EvaluationState | undefined {
    const status = readString(value, "status");
    if (status === "host-call") {
      const call = asRecord(value["call"]);
      return {
        status: "host-call",
        call: {
          evaluationId: readString(call, "evaluationId") ?? "",
          callId: readString(call, "callId") ?? "",
          effect: readString(call, "effect") ?? "",
          name: readString(call, "name") ?? "",
          args: Array.isArray(call["args"]) ? call["args"].map(valueFromOcaml) : [],
        },
      };
    }
    if (status === "completed") {
      return {
        status: "completed",
        result: {
          value: this.#projectSessionValue(
            sessionId,
            valueFromOcaml(value["value"]),
            request.retainValues,
            undefined,
          ),
          ...(readNumber(value, "formCount") !== undefined
            ? { steps: readNumber(value, "formCount") }
            : {}),
          diagnostics: [],
        },
      };
    }
    return undefined;
  }

  #retainProjectedValue(
    sessionId: string,
    value: ValueProjection,
    callSource: string | undefined,
  ): ValueProjection & { readonly valueRef: string } {
    const projected = this.#retainNestedProjectedValues(sessionId, value);
    const valueRef = `ocaml-value-${this.#nextValueRefId++}`;
    this.#sessionValueRefs.get(sessionId)?.set(valueRef, {
      value: projected,
      ...(callSource ? { callSource } : {}),
    });
    return { ...projected, valueRef };
  }

  #retainNestedProjectedValues(sessionId: string, value: ValueProjection): ValueProjection {
    switch (value.kind) {
      case "list":
      case "vector":
        return {
          ...value,
          items: value.items.map((item) => this.#retainProjectedValue(sessionId, item, undefined)),
        };
      case "map":
        return {
          ...value,
          entries: value.entries.map((entry) => ({
            key: this.#retainProjectedValue(sessionId, entry.key, undefined),
            value: this.#retainProjectedValue(sessionId, entry.value, undefined),
          })),
        };
      default:
        return value;
    }
  }

  async available(): Promise<boolean> {
    return existsSync(this.#cliPath);
  }

  private async request(payload: Record<string, unknown>): Promise<AbiResponse> {
    if (!existsSync(this.#cliPath)) {
      throw new Error(
        `Missing OCaml language CLI at ${this.#cliPath}. Build it with \`pnpm --filter @formalang/ocaml build\`.`,
      );
    }
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = spawn(this.#cliPath, ["request", JSON.stringify(payload)], {
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
            `OCaml ABI request failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      });
    });
    return JSON.parse(output) as AbiResponse;
  }

  private async sessionRequest(payload: Record<string, unknown>): Promise<AbiResponse> {
    return JSON.parse(await this.daemonRequest(JSON.stringify(payload))) as AbiResponse;
  }

  #requireSessionConfig(sessionId: string): OcamlSessionConfig {
    const config = this.#sessionConfigs.get(sessionId);
    if (!config) {
      throw new Error(`Unknown language session: ${sessionId}`);
    }
    return config;
  }

  private daemonRequest(payload: string): Promise<string> {
    const daemon = this.requireDaemon();
    return new Promise((resolveOutput, reject) => {
      let settled = false;
      const waiter = (line: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveOutput(line);
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = daemon.waiters.indexOf(waiter);
        if (index >= 0) daemon.waiters.splice(index, 1);
        if (this.#daemon === daemon) {
          this.closeDaemon();
        }
        reject(new Error(`Timed out waiting for OCaml daemon response. stderr: ${daemon.stderr}`));
      }, this.#daemonRequestTimeoutMs);
      daemon.waiters.push(waiter);
      daemon.child.stdin.write(`${payload}\n`);
    });
  }

  private requireDaemon() {
    if (this.#daemon) return this.#daemon;
    if (!existsSync(this.#cliPath)) {
      throw new Error(
        `Missing OCaml language CLI at ${this.#cliPath}. Build it with \`pnpm --filter @formalang/ocaml build\`.`,
      );
    }

    const child = spawn(this.#cliPath, ["daemon"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const daemon = {
      child,
      lines: createInterface({ input: child.stdout }),
      responses: [] as string[],
      waiters: [] as ((line: string) => void)[],
      stderr: "",
    };
    child.stderr.on("data", (chunk) => {
      daemon.stderr += chunk.toString();
    });
    child.on("error", (error) => {
      for (const waiter of daemon.waiters.splice(0)) {
        waiter(
          JSON.stringify({
            ok: false,
            diagnostics: [{ message: error.message, severity: "error", code: "daemon/error" }],
          }),
        );
      }
      if (this.#daemon === daemon) {
        this.#daemon = undefined;
      }
    });
    child.on("exit", (code) => {
      const message = `OCaml language daemon exited with code ${code ?? "unknown"}${daemon.stderr ? `: ${daemon.stderr.trim()}` : ""}`;
      for (const waiter of daemon.waiters.splice(0)) {
        waiter(
          JSON.stringify({
            ok: false,
            diagnostics: [{ message, severity: "error", code: "daemon/exit" }],
          }),
        );
      }
      if (this.#daemon === daemon) {
        this.#daemon = undefined;
      }
    });
    daemon.lines.on("line", (line) => {
      const waiter = daemon.waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        daemon.responses.push(line);
      }
    });
    this.#daemon = daemon;
    return daemon;
  }

  private closeDaemon(): void {
    const daemon = this.#daemon;
    if (!daemon) return;
    daemon.lines.close();
    daemon.child.stdin.end();
    daemon.child.kill();
    this.#daemon = undefined;
  }
}

function unsupportedEvaluation(code: string, message: string): EvaluationState {
  return {
    status: "failed",
    diagnostics: [
      {
        code,
        severity: "error",
        message,
        phase: code.startsWith("host-effect/") ? "host-effect" : "evaluate",
      },
    ],
  };
}

function diagnosticsFromResponse(
  response: AbiResponse,
  phase: DiagnosticPhase,
): readonly Diagnostic[] {
  if (!Array.isArray(response.diagnostics)) return [];
  return response.diagnostics.map((diagnostic) => diagnosticFromAbi(diagnostic, phase));
}

function throwIfAbiFailed(response: AbiResponse, prefix: string): void {
  if (response.ok !== false) return;
  const message = diagnosticsFromResponse(response, "evaluate")
    .map((diagnostic) => diagnostic.message)
    .join("; ");
  throw new Error(message ? `${prefix}: ${message}` : prefix);
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
      return { kind: "opaque", tag: "ocaml-value", display: JSON.stringify(value) };
  }
}

function isOcamlFunctionValue(value: ValueProjection): boolean {
  return value.kind === "opaque" && value.tag === "function";
}

function variableDefinitionSource(variable: SessionVariable): string {
  return `(define ${variable.name} ${printProjectedValue(variable.value)})`;
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

function sessionSourceInfos(value: unknown): readonly SessionSourceInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index): SessionSourceInfo => {
    const record = asRecord(item);
    return {
      sourceId: readString(record, "sourceId") ?? readString(record, "id") ?? `source-${index}`,
      ...(readString(record, "hash") ? { hash: readString(record, "hash") } : {}),
      ...(readNumber(record, "order") !== undefined ? { order: readNumber(record, "order") } : {}),
      ...(readNumber(record, "textLength") !== undefined
        ? { textLength: readNumber(record, "textLength") }
        : {}),
      ...(readNumber(record, "formCount") !== undefined
        ? { formCount: readNumber(record, "formCount") }
        : {}),
    };
  });
}
