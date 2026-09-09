import { Effect, Ref } from "effect";
import * as Builtins from "@formalang/ts/builtins";
import { KernelTypeError, type KernelError } from "@formalang/ts/diagnostic";
import { Env } from "@formalang/ts/env";
import * as Evaluator from "@formalang/ts/evaluator";
import type { BuiltinFn, KFn, KValue } from "@formalang/ts/evaluator";
import * as Lsp from "@formalang/ts/lsp";
import * as Reader from "@formalang/ts/reader";
import * as Engine from "@formalang/ts/engine";
import * as LanguageSession from "@formalang/ts/session";
import * as VM from "@formalang/ts/vm";

import { typeProjection } from "./abi-projections.js";
import { keyStringFromProjection, projectInlineValue } from "./value-projections.js";
import type {
  AbortEvaluationRequest,
  AbortEvaluationResult,
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
  HostCall,
  HostCallResumeResult,
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
  SessionInfoRequest,
  SessionInfoResult,
  TypePolicy,
  TypecheckRequest,
  TypecheckResult,
  ValueProjection,
  VersionResult,
  SyntaxTreeProjection,
} from "./types.js";

const DEFAULT_STEP_LIMIT = 50_000;

interface TsSession {
  readonly sessionId: string;
  readonly language: LanguageSession.LanguageSession;
  readonly valueRefs: Map<string, TsRetainedValue>;
  defaultStepLimit: number;
  hostBuiltins: readonly HostBuiltinDescriptor[];
  typePolicy?: TypePolicy | undefined;
  readonly evaluations: Map<string, TsPendingEvaluation>;
}

interface TsRetainedValue {
  readonly value: KValue;
  readonly apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined;
  readonly invoke?: ((request: CallValueRequest) => Promise<EvaluationState>) | undefined;
}

interface TsPendingHostCall {
  readonly call: HostCall;
  readonly resume: (result: HostCallResumeResult) => void;
}

interface TsPendingEvaluation {
  readonly session: TsSession;
  readonly evaluationId: string;
  readonly sourceId: string;
  completed: boolean;
  aborted: boolean;
  pendingCall?: TsPendingHostCall | undefined;
  readonly callQueue: HostCall[];
  readonly callWaiters: ((call: HostCall) => void)[];
  readonly completion: Promise<EvaluationState>;
}

function valueProjection(value: KValue): ValueProjection {
  if (value === null) return { kind: "nil" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { kind: "int", value } : { kind: "float", value };
  }
  if (typeof value === "string") return { kind: "string", value };
  if (Array.isArray(value)) return { kind: "list", items: value.map(valueProjection) };
  if (Evaluator.isKMap(value)) {
    return {
      kind: "map",
      entries: [...value.entries()].map(([key, nested]) => ({
        key: { kind: "string", value: key },
        value: valueProjection(nested),
      })),
    };
  }
  if (Evaluator.isKFn(value)) {
    return { kind: "function", valueRef: "ts:function", display: Evaluator.printKValue(value) };
  }
  if (Evaluator.isKSExpr(value)) {
    return { kind: "opaque", tag: "sexpr", display: Evaluator.printKValue(value) };
  }
  if (Evaluator.isKMacro(value)) {
    return { kind: "opaque", tag: "macro", display: value.name };
  }
  if (Evaluator.isKMeta(value)) {
    return { kind: "opaque", tag: "meta", display: Evaluator.printKValue(value) };
  }
  return { kind: "opaque", tag: "unknown", display: String(value) };
}

export class TsLanguageHost implements LanguageHost {
  readonly name = "ts";
  #nextSessionId = 1;
  #nextEvaluationId = 1;
  #nextCallId = 1;
  #nextValueRefId = 1;
  readonly #sessions = new Map<string, TsSession>();

  async version(): Promise<VersionResult> {
    return {
      engine: "forma-typescript",
      engineVersion: "0.0.0",
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
        "callValue",
        "resumeHostCall",
        "abortEvaluation",
        "projectValue",
        "releaseValue",
        "sessionInfo",
        "resetSession",
        "closeSession",
      ],
    };
  }

  async openSession(request: OpenSessionRequest = {}): Promise<OpenSessionResult> {
    const sessionId = `ts-session-${this.#nextSessionId++}`;
    this.#sessions.set(sessionId, {
      sessionId,
      language: LanguageSession.openSession({ id: sessionId }),
      valueRefs: new Map(),
      defaultStepLimit: request.defaultStepLimit ?? DEFAULT_STEP_LIMIT,
      hostBuiltins: [],
      evaluations: new Map(),
    });
    return { sessionId };
  }

  async configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult> {
    const session = this.#requireSession(request.sessionId);
    if (request.variables) {
      session.language.env = session.language.env.extend(variablesToBindings(request.variables));
    }
    if (request.hostBuiltins) {
      session.hostBuiltins = request.hostBuiltins;
    }
    if (request.typePolicy) {
      session.typePolicy = request.typePolicy;
    }
    return {
      sessionId: session.sessionId,
      bindingCount: request.variables?.length ?? 0,
      builtinCount: session.hostBuiltins.length,
    };
  }

  async loadSource(request: LoadSourceRequest): Promise<LoadSourceResult> {
    const session = this.#requireSession(request.sessionId);
    const parsed = Engine.parseSource({ sourceId: request.sourceId, source: request.source });
    const kind = request.kind === "prelude" ? "prelude" : "source";
    session.language.rememberSource({ id: request.sourceId, text: request.source, kind });
    if (parsed.diagnostics.length === 0) {
      session.language.rememberParsedSource(kind, request.sourceId, parsed.exprs);
    }
    return {
      sourceId: request.sourceId,
      formCount: parsed.ast.length,
      diagnostics: parsed.diagnostics,
    };
  }

  async loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult> {
    const sources: LoadSourceResult[] = [];
    for (const source of request.sources) {
      sources.push(await this.loadSource({ ...source, sessionId: request.sessionId }));
    }
    return {
      sources,
      diagnostics: sources.flatMap((source) => source.diagnostics),
    };
  }

  async parse(request: ParseRequest): Promise<ParseResult> {
    return this.parseSync(request);
  }

  parseSync(request: ParseRequest): ParseResult {
    return Engine.parse(request);
  }

  async expand(request: ExpandRequest): Promise<ExpandResult> {
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    return Engine.expand({ ...request, session: session?.language });
  }

  async typecheck(request: TypecheckRequest): Promise<TypecheckResult> {
    return this.typecheckSync(request);
  }

  typecheckSync(request: TypecheckRequest): TypecheckResult {
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    return Engine.typecheck({
      ...request,
      session: session?.language,
      hostBuiltins: request.hostBuiltins ?? session?.hostBuiltins,
      typePolicy: request.typePolicy ?? session?.typePolicy,
    });
  }

  async evaluate(request: EvaluateRequest): Promise<EvaluationResult> {
    const sourceId = request.sourceId ?? "source";
    const result = await Engine.evaluate({
      sourceId,
      source: request.source,
      stepLimit: request.stepLimit ?? DEFAULT_STEP_LIMIT,
      ...(request.variables ? { env: Env.from(variablesToBindings(request.variables)) } : {}),
    });
    if (result.diagnostics.length > 0) {
      return {
        value: { kind: "nil" },
        diagnostics: result.diagnostics,
      };
    }
    return {
      value: valueProjection(result.value),
      printed: result.printed,
      steps: result.steps,
      diagnostics: [],
    };
  }

  async evaluateInSession(request: EvaluateInSessionRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const source =
      request.source ??
      (request.sourceId !== undefined
        ? session.language.sourceText(request.sourceId)
        : session.language.joinedSourceText());
    if (source === undefined) {
      return {
        status: "failed",
        diagnostics: [
          {
            code: "session/source-not-found",
            severity: "error",
            message: `No loaded source found for ${request.sourceId ?? "session"}`,
            phase: "evaluate",
          },
        ],
      };
    }
    const env = request.variables
      ? session.language.env.extend(variablesToBindings(request.variables))
      : session.language.env;
    if (session.hostBuiltins.length > 0) {
      return this.#evaluateInSessionWithHostBuiltins(session, request, source, env);
    }

    const result = await Engine.evaluateInSession({
      session: session.language,
      sourceId: request.sourceId,
      source,
      env,
      stepLimit: request.stepLimit ?? session.defaultStepLimit,
    });
    if (result.diagnostics.length > 0) {
      return {
        status: "failed",
        diagnostics: result.diagnostics,
      };
    }
    return {
      status: "completed",
      result: {
        value: this.#projectValue(session, result.value, request.retainValues),
        printed: result.printed,
        steps: result.steps,
        diagnostics: [],
      },
    };
  }

  async callValue(request: CallValueRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const retained = session.valueRefs.get(request.valueRef);
    if (!retained) {
      return failedEvaluation("value-ref/not-found", "No retained TS value found to call");
    }
    if (retained.invoke) {
      return retained.invoke(request);
    }
    if (!retained.apply) {
      return failedEvaluation(
        "value-ref/unsupported",
        "Retained TS value does not have a callable continuation",
      );
    }
    try {
      const value = await Effect.runPromise(retained.apply(request.args.map(kValueFromProjection)));
      return {
        status: "completed",
        result: {
          value: this.#projectValue(session, value, request.retainValues),
          printed: Evaluator.printKValue(value),
          diagnostics: [],
        },
      };
    } catch (error) {
      return {
        status: "failed",
        diagnostics: [Engine.diagnosticFromUnknown(error, "evaluate", "value-ref")],
      };
    }
  }

  async resumeHostCall(request: ResumeHostCallRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const evaluation = session.evaluations.get(request.evaluationId);
    if (!evaluation || evaluation.completed) {
      return failedEvaluation("evaluation/not-found", "No retained TS evaluation found to resume");
    }
    const pendingCall = evaluation.pendingCall;
    if (!pendingCall || pendingCall.call.callId !== request.callId) {
      return failedEvaluation("host-effect/call-not-found", "No matching retained host call found");
    }
    evaluation.pendingCall = undefined;
    pendingCall.resume(request.result);
    return this.#nextEvaluationState(evaluation);
  }

  async abortEvaluation(request: AbortEvaluationRequest): Promise<AbortEvaluationResult> {
    const session = this.#requireSession(request.sessionId);
    const evaluation = session.evaluations.get(request.evaluationId);
    if (evaluation && !evaluation.completed) {
      evaluation.aborted = true;
      evaluation.pendingCall?.resume({
        ok: false,
        diagnostics: [
          {
            code: "evaluation/aborted",
            severity: "error",
            message: request.reason ?? "Evaluation aborted",
            phase: "evaluate",
          },
        ],
      });
      session.evaluations.delete(request.evaluationId);
    }
    return { evaluationId: request.evaluationId, aborted: true };
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
              message: "Projecting a retained TS value requires a sessionId",
              phase: "evaluate",
            },
          ],
        };
      }
      const session = this.#requireSession(request.sessionId);
      const retained = session.valueRefs.get(request.valueRef);
      if (retained) {
        const value = this.#projectRetainedValue(retained.value, request.valueRef);
        return {
          ...projectInlineValue(value, request.projections),
          diagnostics: [],
        };
      }
      return {
        value: { kind: "nil" },
        diagnostics: [
          {
            code: "value-ref/not-found",
            severity: "error",
            message: "No retained TS value found to project",
            phase: "evaluate",
          },
        ],
      };
    }
    const value = request.value ?? { kind: "nil" };
    return {
      ...projectInlineValue(value, request.projections),
      diagnostics: [],
    };
  }

  async releaseValue(request: ReleaseValueRequest): Promise<ReleaseValueResult> {
    const session = this.#requireSession(request.sessionId);
    const released: string[] = [];
    for (const valueRef of request.valueRefs) {
      if (session.valueRefs.delete(valueRef)) {
        released.push(valueRef);
      }
    }
    return { released };
  }

  async sessionInfo(request: SessionInfoRequest): Promise<SessionInfoResult> {
    const session = this.#requireSession(request.sessionId);
    return {
      ...LanguageSession.sessionInfo(session.language),
      diagnostics: [],
    };
  }

  async resetSession(request: ResetSessionRequest): Promise<ResetSessionResult> {
    const session = this.#requireSession(request.sessionId);
    session.language.reset();
    session.valueRefs.clear();
    session.evaluations.clear();
    session.hostBuiltins = [];
    session.typePolicy = undefined;
    return {
      sessionId: request.sessionId,
      reset: true,
      diagnostics: [],
    };
  }

  async closeSession(request: CloseSessionRequest): Promise<CloseSessionResult> {
    const session = this.#sessions.get(request.sessionId);
    if (session) {
      session.evaluations.clear();
      session.valueRefs.clear();
      this.#sessions.delete(request.sessionId);
    }
    return { sessionId: request.sessionId, closed: true };
  }

  async analyzeEditor(request: EditorAnalysisRequest): Promise<EditorAnalysisResult> {
    const sourceId = request.sourceId ?? "source";
    const parse = editorParseProjection(sourceId, request.source);
    const lspResult = await Effect.runPromise(Lsp.analyzeLsp(request.source, {}));
    return {
      sourceId,
      success: lspResult.success,
      ...(lspResult.resultTypeString
        ? {
            resultTypeDisplay: lspResult.resultTypeString,
            resultType: typeProjection(lspResult.resultTypeString),
          }
        : {}),
      typedSpans: lspResult.typedSpans.map((span) => ({
        id: span.id,
        span: {
          sourceId,
          startOffset: span.span.start,
          endOffset: span.span.end,
        },
        display: span.typeString,
        type: typeProjection(span.typeString),
        code: span.code,
        exprTag: span.exprTag,
      })),
      errors: lspResult.errors.map((error) => ({
        message: error.message,
        ...(error.span
          ? {
              span: {
                sourceId,
                startOffset: error.span.start,
                endOffset: error.span.end,
              },
            }
          : {}),
        ...(error.code ? { code: error.code } : {}),
      })),
      diagnostics: lspResult.diagnostics.map((diagnostic) => ({
        code: `${diagnostic.source}/diagnostic`,
        severity: diagnostic.severity,
        message: diagnostic.message,
        phase: "typecheck",
        ...(diagnostic.span
          ? {
              span: {
                sourceId,
                startOffset: diagnostic.span.start,
                endOffset: diagnostic.span.end,
              },
            }
          : {}),
      })),
      parse,
    };
  }

  #requireSession(sessionId: string): TsSession {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown language session: ${sessionId}`);
    }
    return session;
  }

  #evaluateInSessionWithHostBuiltins(
    session: TsSession,
    request: EvaluateInSessionRequest,
    source: string,
    env: Env,
  ): Promise<EvaluationState> {
    const sourceId = request.sourceId ?? "session";
    const evaluationId = `ts-eval-${this.#nextEvaluationId++}`;
    const evaluation = createPendingEvaluation(session, evaluationId, sourceId);
    const builtins = {
      ...Builtins.defaultBuiltins,
      ...this.#hostBuiltinFns(evaluation, session.hostBuiltins),
    };
    const completion = Effect.runPromise(
      Effect.provide(
        Evaluator.evaluate(source, {
          stepLimit: request.stepLimit ?? session.defaultStepLimit,
          builtins,
          env,
        }),
        Evaluator.makePreludeLayer(builtins),
      ),
    )
      .then((result): EvaluationState => {
        if (!evaluation.aborted) {
          session.language.env = result.env;
        }
        return {
          status: "completed",
          result: {
            value: this.#projectValue(session, result.value, request.retainValues),
            printed: Evaluator.printKValue(result.value),
            steps: result.steps,
            diagnostics: [],
          },
        };
      })
      .catch(
        (error): EvaluationState => ({
          status: "failed",
          diagnostics: [Engine.diagnosticFromUnknown(error, "evaluate", sourceId)],
        }),
      );
    Object.assign(evaluation, { completion });
    session.evaluations.set(evaluationId, evaluation);
    return this.#nextEvaluationState(evaluation);
  }

  #hostBuiltinFns(
    evaluation: TsPendingEvaluation,
    descriptors: readonly HostBuiltinDescriptor[],
  ): Record<string, BuiltinFn> {
    return Object.fromEntries(
      descriptors.map((descriptor) => [
        descriptor.name,
        (args: readonly KValue[], apply) =>
          this.#pauseForHostCall(evaluation, descriptor, args, apply),
      ]),
    );
  }

  #pauseForHostCall(
    evaluation: TsPendingEvaluation,
    descriptor: HostBuiltinDescriptor,
    args: readonly KValue[],
    apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
  ): Effect.Effect<KValue, KernelError> {
    return Effect.async<KValue, KernelError>((resume) => {
      if (evaluation.aborted) {
        resume(Effect.fail(hostCallDiagnosticsError("evaluation/aborted", "Evaluation aborted")));
        return Effect.void;
      }
      const call: HostCall = {
        evaluationId: evaluation.evaluationId,
        callId: `ts-call-${this.#nextCallId++}`,
        effect: descriptor.handler.effect,
        name: descriptor.name,
        args: args.map((arg) =>
          this.#projectValue(evaluation.session, arg, "functions", (callArgs) =>
            apply(arg, callArgs),
          ),
        ),
      };
      const pendingCall: TsPendingHostCall = {
        call,
        resume: (result) => {
          if (result.ok) {
            resume(Effect.succeed(kValueFromProjection(result.value)));
          } else {
            resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics(result.diagnostics)));
          }
        },
      };
      evaluation.pendingCall = pendingCall;
      enqueueHostCall(evaluation, call);
      return Effect.sync(() => {
        if (evaluation.pendingCall === pendingCall) {
          evaluation.pendingCall = undefined;
        }
      });
    });
  }

  #projectValue(
    session: TsSession,
    value: KValue,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
    apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined,
  ): ValueProjection {
    if (value === null) {
      return this.#maybeRetainProjectedValue(session, value, { kind: "nil" }, retainValues);
    }
    if (typeof value === "boolean") {
      return this.#maybeRetainProjectedValue(session, value, { kind: "bool", value }, retainValues);
    }
    if (typeof value === "number") {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        Number.isInteger(value) ? { kind: "int", value } : { kind: "float", value },
        retainValues,
      );
    }
    if (typeof value === "string") {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        { kind: "string", value },
        retainValues,
      );
    }
    if (Array.isArray(value)) {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        {
          kind: "list",
          items: value.map((item) => this.#projectValue(session, item, retainValues)),
        },
        retainValues,
      );
    }
    if (Evaluator.isKMap(value)) {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        {
          kind: "map",
          entries: [...value.entries()].map(([key, nested]) => ({
            key: this.#maybeRetainProjectedValue(
              session,
              key,
              { kind: "string", value: key },
              retainValues,
            ),
            value: this.#projectValue(session, nested, retainValues),
          })),
        },
        retainValues,
      );
    }
    if (Evaluator.isKFn(value)) {
      if (retainValues === "functions" || retainValues === "all") {
        const valueRef = this.#retainValue(
          session,
          value,
          apply,
          this.#callableValueInvoker(session, value),
        );
        return { kind: "function", valueRef, display: Evaluator.printKValue(value) };
      }
      return valueProjection(value);
    }
    const projected = valueProjection(value);
    return this.#maybeRetainProjectedValue(session, value, projected, retainValues);
  }

  #projectRetainedValue(value: KValue, valueRef: string): ValueProjection {
    if (Evaluator.isKFn(value)) {
      return { kind: "function", valueRef, display: Evaluator.printKValue(value) };
    }
    return { ...valueProjection(value), valueRef };
  }

  #maybeRetainProjectedValue(
    session: TsSession,
    value: KValue,
    projected: ValueProjection,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
  ): ValueProjection {
    if (retainValues !== "all") return projected;
    if (projected.kind === "function") return projected;
    return { ...projected, valueRef: this.#retainValue(session, value) };
  }

  #retainValue(
    session: TsSession,
    value: KValue,
    apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined,
    invoke?: ((request: CallValueRequest) => Promise<EvaluationState>) | undefined,
  ): string {
    const valueRef = `ts-value-${this.#nextValueRefId++}`;
    session.valueRefs.set(valueRef, {
      value,
      ...(apply ? { apply } : {}),
      ...(invoke ? { invoke } : {}),
    });
    return valueRef;
  }

  #callableValueInvoker(
    session: TsSession,
    value: KValue,
  ): ((request: CallValueRequest) => Promise<EvaluationState>) | undefined {
    if (!Evaluator.isKFn(value)) return undefined;
    return (request) => this.#invokeCallableValue(session, value, request);
  }

  #invokeCallableValue(
    session: TsSession,
    value: KFn,
    request: CallValueRequest,
  ): Promise<EvaluationState> {
    const sourceId = "value-ref";
    const evaluationId = `ts-eval-${this.#nextEvaluationId++}`;
    const evaluation = createPendingEvaluation(session, evaluationId, sourceId);
    const builtins = {
      ...Builtins.defaultBuiltins,
      ...this.#hostBuiltinFns(evaluation, session.hostBuiltins),
    };
    const args = request.args.map(kValueFromProjection);
    const completion = Effect.runPromise(
      Effect.gen(function* () {
        if (VM.getVMClosure(value)) {
          const stepCounter = yield* Ref.make(0);
          const builtinRegistry = new VM.BuiltinRegistry(builtins);
          const runtime = {
            builtins: builtinRegistry.toArray(builtins),
            builtinLookup: builtinRegistry.toMap(builtins),
            globals: [],
            stepLimit: request.stepLimit ?? session.defaultStepLimit,
            strictGlobals: true,
            stepCounter,
          };
          return yield* value.apply!(args, runtime);
        }

        const counter = yield* Ref.make(0);
        const runtime = {
          builtins,
          counter,
          stepLimit: request.stepLimit ?? session.defaultStepLimit,
        };
        return yield* Evaluator.applyKFn(value, args, runtime);
      }),
    )
      .then(
        (value): EvaluationState => ({
          status: "completed",
          result: {
            value: this.#projectValue(session, value, request.retainValues),
            printed: Evaluator.printKValue(value),
            diagnostics: [],
          },
        }),
      )
      .catch(
        (error): EvaluationState => ({
          status: "failed",
          diagnostics: [Engine.diagnosticFromUnknown(error, "evaluate", sourceId)],
        }),
      );
    Object.assign(evaluation, { completion });
    session.evaluations.set(evaluationId, evaluation);
    return this.#nextEvaluationState(evaluation);
  }

  async #nextEvaluationState(evaluation: TsPendingEvaluation): Promise<EvaluationState> {
    const state = await Promise.race([
      evaluation.completion.then((state) => ({ kind: "completion" as const, state })),
      waitForHostCall(evaluation).then((call) => ({ kind: "host-call" as const, call })),
    ]);
    if (state.kind === "host-call") {
      return { status: "host-call", call: state.call };
    }
    evaluation.completed = true;
    evaluation.session.evaluations.delete(evaluation.evaluationId);
    return state.state;
  }
}

function failedEvaluation(code: string, message: string): EvaluationState {
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

function createPendingEvaluation(
  session: TsSession,
  evaluationId: string,
  sourceId: string,
): TsPendingEvaluation {
  return {
    session,
    evaluationId,
    sourceId,
    completed: false,
    aborted: false,
    callQueue: [],
    callWaiters: [],
    completion: Promise.resolve(
      failedEvaluation("evaluation/not-started", "TS evaluation has not started"),
    ),
  };
}

function enqueueHostCall(evaluation: TsPendingEvaluation, call: HostCall): void {
  const waiter = evaluation.callWaiters.shift();
  if (waiter) {
    waiter(call);
  } else {
    evaluation.callQueue.push(call);
  }
}

function waitForHostCall(evaluation: TsPendingEvaluation): Promise<HostCall> {
  const queued = evaluation.callQueue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    evaluation.callWaiters.push(resolve);
  });
}

function hostCallDiagnosticsError(code: string, message: string): KernelTypeError {
  return new KernelTypeError({
    message,
    expected: "successful host call",
    got: code,
  });
}

function hostCallDiagnosticsErrorFromDiagnostics(
  diagnostics: readonly Diagnostic[],
): KernelTypeError {
  const first = diagnostics[0];
  return hostCallDiagnosticsError(
    first?.code ?? "host-effect/failed",
    first?.message ?? "Host call failed",
  );
}

function variablesToBindings(
  variables: readonly {
    readonly name: string;
    readonly value: ValueProjection;
  }[],
): Record<string, KValue> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, kValueFromProjection(variable.value)]),
  );
}

function kValueFromProjection(value: ValueProjection): KValue {
  switch (value.kind) {
    case "nil":
      return null;
    case "bool":
    case "int":
    case "float":
    case "string":
    case "keyword":
    case "symbol":
      return value.value;
    case "list":
    case "vector":
      return value.items.map(kValueFromProjection);
    case "map":
      return new Map(
        value.entries.map((entry) => [
          keyStringFromProjection(entry.key),
          kValueFromProjection(entry.value),
        ]),
      );
    case "function":
    case "opaque":
      return value.display ?? value.kind;
  }
}

function editorParseProjection(sourceId: string, source: string): EditorAnalysisResult["parse"] {
  const result = Reader.parse(source);
  return {
    errors: result.errors.map((error) => ({
      message: error.message,
      ...(error.loc ? { span: spanFromReaderLoc(sourceId, error.loc) } : {}),
    })),
    greenTree: serializeGreenNode(sourceId, result.greenTree, source),
    redTree: serializeRedNode(sourceId, result.redTree),
  };
}

function serializeGreenNode(
  sourceId: string,
  node: ReturnType<typeof Reader.parse>["greenTree"],
  source: string,
  offset = 0,
  depth = 0,
): SyntaxTreeProjection {
  if (depth > 6) {
    return {
      kind: `${node.kind} (max-depth)`,
      span: { sourceId, startOffset: offset, endOffset: offset },
    };
  }

  let cursor = offset;
  return {
    kind: node.kind,
    span: { sourceId, startOffset: offset, endOffset: offset + node.width },
    text: source.slice(offset, offset + node.width),
    children: node.children.map((child) => {
      const childOffset = cursor;
      cursor += child.width;
      if (Reader.isGreenNode(child)) {
        return serializeGreenNode(sourceId, child, source, childOffset, depth + 1);
      }
      return {
        kind: "Token",
        tokenType: child.tokenType,
        span: {
          sourceId,
          startOffset: childOffset,
          endOffset: childOffset + child.width,
        },
        text: `${child.leadingTrivia.map((trivia) => trivia.text).join("")}${child.text}`,
      };
    }),
  };
}

function serializeRedNode(
  sourceId: string,
  node: ReturnType<typeof Reader.parse>["redTree"],
  depth = 0,
): SyntaxTreeProjection {
  if (depth > 6) {
    const fullSpan = node.fullSpan();
    return {
      kind: `${node.kind()} (max-depth)`,
      span: {
        sourceId,
        startOffset: fullSpan.start,
        endOffset: fullSpan.end,
      },
    };
  }

  const fullSpan = node.fullSpan();
  return {
    kind: node.kind(),
    span: {
      sourceId,
      startOffset: fullSpan.start,
      endOffset: fullSpan.end,
    },
    text: node.fullText(),
    children: node.children().map((child) => {
      if (Reader.isRedNode(child)) {
        return serializeRedNode(sourceId, child, depth + 1);
      }
      const span = child.fullSpan();
      return {
        kind: "Token",
        tokenType: child.tokenType(),
        span: {
          sourceId,
          startOffset: span.start,
          endOffset: span.end,
        },
        text: child.fullText(),
      };
    }),
  };
}

function spanFromReaderLoc(sourceId: string, loc: Reader.Loc) {
  return {
    sourceId,
    startOffset: loc.start,
    endOffset: loc.end,
    startLine: loc.line,
    startColumn: loc.col,
  };
}
