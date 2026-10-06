import { KKeyword, mapKey, quotedDatum } from "../evaluator/types.js";
/**
 * Stack-based bytecode virtual machine for the Lisp kernel.
 *
 * Executes compiled Chunks. Uses a flat value stack with frame pointers
 * for local variable access. Tail calls reuse frames for O(1) stack space.
 *
 * Effect integration: CALL_BUILTIN yields to Effect-TS for builtin dispatch.
 * The VM loop itself runs inside an Effect.gen so it can yield* for async builtins.
 */

import type { KernelObserver } from "../evaluator/observation.js";
import { Effect, Ref } from "effect";
import type { KValue, KFn, BuiltinFn } from "../evaluator/types.js";
import {
  asNumber,
  isTruthy,
  kEquals,
  isKBuiltin,
  isKFn,
  TypeCheckError,
} from "../evaluator/types.js";
import { Env } from "../Env.js";
import type { KernelError, KernelStackFrame } from "../diagnostic/errors.js";
import { KernelTypeError, ArityError, StepLimitExceeded, FailError } from "../diagnostic/errors.js";
import { matchCompiledPattern, type CompiledMatchPattern } from "../evaluator/match.js";
import type { SourceTrace } from "../evaluator/source-trace.js";
import type { SExpr } from "../reader/index.js";
import { evalQuasiquoteTemplate } from "../evaluator/quasiquote.js";
import type { Chunk } from "./opcodes.js";
import { Op } from "./opcodes.js";

// ---------------------------------------------------------------------------
// VM Closure — stored internally on a KFn via __vmClosure property
// ---------------------------------------------------------------------------

export interface VMClosureData {
  readonly chunk: Chunk;
  readonly upvalues: UpvalueCell[];
}

export interface UpvalueCell {
  value: KValue;
}

interface VMRuntime {
  readonly builtins: BuiltinFn[];
  readonly builtinLookup: ReadonlyMap<string, BuiltinFn>;
  readonly globals: KValue[];
  readonly stepLimit: number;
  readonly globalNames?: readonly (string | undefined)[];
  readonly strictGlobals?: boolean;
  readonly stepCounter: Ref.Ref<number>;
  readonly observer?: KernelObserver;
}

interface DispatchWrapperData {
  readonly methodName: string;
  readonly className: string;
  readonly dispatchArgIndex: number;
  readonly implementations: Map<string, KFn>;
}

function canonicalRuntimeTypeName(name: string): string {
  switch (name) {
    case "Num":
      return "Number";
    case "Str":
      return "String";
    case "Bool":
      return "Boolean";
    case "Nil":
      return "Unit";
    default:
      return name;
  }
}

function runtimeTypeName(val: KValue): string {
  if (val === null) return "Unit";
  if (Array.isArray(val)) return "List";
  if (val instanceof Map) return "Map";
  if (typeof val === "number") return "Number";
  if (typeof val === "string") return "String";
  if (typeof val === "boolean") return "Boolean";
  return "Unknown";
}

/** Symbol key to attach VM closure data to a KFn */
const VM_CLOSURE_KEY = Symbol.for("forma/vm-closure");
const VM_DISPATCH_WRAPPER_KEY = Symbol.for("forma/vm-dispatch-wrapper");

/** A KFn that wraps a VM closure. Builtins see a normal KFn with apply. */
interface VMKFn extends KFn {
  readonly [VM_CLOSURE_KEY]: VMClosureData;
}

interface VMDispatchKFn extends KFn {
  readonly [VM_DISPATCH_WRAPPER_KEY]: DispatchWrapperData;
}

/** Extract VMClosureData from a value, if it's a VM-compiled function */
export function getVMClosure(v: unknown): VMClosureData | null {
  if (v !== null && typeof v === "object" && VM_CLOSURE_KEY in v) {
    return (v as VMKFn)[VM_CLOSURE_KEY];
  }
  return null;
}

function getDispatchWrapperData(v: unknown): DispatchWrapperData | null {
  if (v !== null && typeof v === "object" && VM_DISPATCH_WRAPPER_KEY in v) {
    return (v as VMDispatchKFn)[VM_DISPATCH_WRAPPER_KEY];
  }
  return null;
}

function getVMRuntime(context: unknown): VMRuntime | null {
  if (context !== null && typeof context === "object") {
    return context as VMRuntime;
  }
  return null;
}

function applyKFnValue(
  fn: KFn,
  args: readonly KValue[],
  runtime: VMRuntime,
): Effect.Effect<KValue, KernelError> {
  const vmData = getVMClosure(fn);
  if (vmData) {
    return runClosure(vmData, args as KValue[], runtime);
  }
  if (fn.apply) {
    return fn.apply(args, runtime);
  }
  return Effect.fail(
    new KernelTypeError({
      message: "Cannot apply function without VM closure or apply implementation",
      expected: "VM closure or callable function",
      got: "plain function",
    }),
  );
}

function applyCallableValue(
  fn: KValue,
  args: readonly KValue[],
  runtime: VMRuntime,
): Effect.Effect<KValue, KernelError> {
  if (isKBuiltin(fn)) {
    const builtin = runtime.builtinLookup.get(fn.name);
    if (builtin) {
      return builtin(args, (innerFn, innerArgs) => applyCallableValue(innerFn, innerArgs, runtime));
    }
  }
  if (isKFn(fn)) {
    return applyKFnValue(fn, args, runtime);
  }
  return Effect.fail(
    new KernelTypeError({
      message: `Cannot call ${typeof fn} as function`,
      expected: "function",
      got: typeof fn,
    }),
  );
}

function makeDispatchWrapper(
  methodName: string,
  className: string,
  dispatchArgIndex: number,
  implementations: Map<string, KFn> = new Map(),
): KFn {
  const data: DispatchWrapperData = {
    methodName,
    className,
    dispatchArgIndex,
    implementations,
  };
  const wrapper: VMDispatchKFn = {
    _tag: "KFn",
    params: ["__dispatch_arg"],
    body: {
      _tag: "Sym" as const,
      name: "nil",
      loc: { start: 0, end: 0, line: 0, col: 0 },
    },
    closure: Env.empty(),
    apply: (args: readonly KValue[], context?: unknown) =>
      Effect.gen(function* () {
        const runtime = getVMRuntime(context);
        if (!runtime) {
          return yield* new KernelTypeError({
            message: "VM runtime not initialized — cannot dispatch instance method",
            expected: "active VM runtime",
            got: "no runtime",
          });
        }

        const dispatchArg = args[data.dispatchArgIndex];
        if (dispatchArg === undefined) {
          return yield* new ArityError({
            name: methodName,
            expected: `${data.dispatchArgIndex + 1}+`,
            got: args.length,
          });
        }

        const typeName = runtimeTypeName(dispatchArg);
        const impl = data.implementations.get(typeName);
        if (!impl) {
          return yield* new KernelTypeError({
            message: `No instance of ${data.className} for ${typeName} (method: ${methodName})`,
            expected: `${data.className} ${typeName} instance`,
            got: "no instance",
          });
        }

        return yield* applyKFnValue(impl, args, runtime);
      }),
    [VM_DISPATCH_WRAPPER_KEY]: data,
  };
  return wrapper;
}

/**
 * Create a KFn that wraps a VM closure. This is what gets pushed on the
 * value stack and stored in globals. Builtins see it as a normal KFn
 * (passes isKFn check), and the VM recognizes it via getVMClosure().
 */
function makeVMKFn(chunk: Chunk, upvalues: UpvalueCell[]): KFn {
  const vmData: VMClosureData = { chunk, upvalues };
  const kfn: VMKFn = {
    _tag: "KFn",
    params: Array.from({ length: chunk.arity }, (_, i) => `__arg_${i}`),
    ...(chunk.variadic ? { restParam: "__rest" } : {}),
    body: { _tag: "Sym" as const, name: "nil", loc: { start: 0, end: 0, line: 0, col: 0 } },
    closure: Env.empty(),
    apply: (args: readonly KValue[], context?: unknown) => {
      const runtime = getVMRuntime(context);
      if (!runtime) {
        return Effect.fail(
          new KernelTypeError({
            message: "VM runtime not initialized — cannot apply VM closure",
            expected: "active VM runtime",
            got: "no runtime",
          }),
        );
      }
      return runClosure(vmData, args as KValue[], runtime);
    },
    [VM_CLOSURE_KEY]: vmData,
  };
  return kfn;
}

function hasValidArity(chunk: Chunk, argc: number): boolean {
  return chunk.variadic ? argc >= chunk.arity : argc === chunk.arity;
}

function expectedArity(chunk: Chunk): number | string {
  return chunk.variadic ? `${chunk.arity}+` : chunk.arity;
}

// ---------------------------------------------------------------------------
// Call frame
// ---------------------------------------------------------------------------

interface CallFrame {
  chunk: Chunk;
  upvalues: UpvalueCell[];
  ip: number;
  stackBase: number;
  callTrace?: SourceTrace;
}

// ---------------------------------------------------------------------------
// VM execution
// ---------------------------------------------------------------------------

export interface VMOptions {
  /** Ordered builtin functions matching BuiltinRegistry indices */
  builtins: BuiltinFn[];
  /** Name lookup for first-class builtin values */
  builtinLookup?: ReadonlyMap<string, BuiltinFn>;
  /** Global variable storage (shared across calls) */
  globals: KValue[];
  /** Step limit for safety (0 = unlimited) */
  stepLimit: number;
  /** Optional names for globals so strict-global errors can reference symbols */
  globalNames?: readonly (string | undefined)[];
  /** When true, loading an undefined global fails instead of yielding nil */
  strictGlobals?: boolean;
  /** Receives values for `OBSERVE` instructions */
  observer?: KernelObserver;
}

export interface VMRunResult {
  readonly value: KValue;
  readonly steps: number;
}

/**
 * Execute a compiled chunk in the VM.
 * Returns the final value left on the stack.
 */
export function runChunk(topChunk: Chunk, options: VMOptions): Effect.Effect<KValue, KernelError> {
  return runChunkWithStats(topChunk, options).pipe(Effect.map((result) => result.value));
}

export function runChunkWithStats(
  topChunk: Chunk,
  options: VMOptions,
): Effect.Effect<VMRunResult, KernelError> {
  return Effect.gen(function* () {
    const runtime: VMRuntime = {
      builtins: options.builtins,
      builtinLookup: options.builtinLookup ?? new Map(),
      globals: options.globals,
      stepLimit: options.stepLimit,
      ...(options.globalNames ? { globalNames: options.globalNames } : {}),
      ...(options.strictGlobals !== undefined ? { strictGlobals: options.strictGlobals } : {}),
      ...(options.observer ? { observer: options.observer } : {}),
      stepCounter: yield* Ref.make(0),
    };
    return yield* executeVM(topChunk, [], runtime);
  });
}

/**
 * Core VM execution loop. Shared between runChunk (top-level) and
 * runClosure (for higher-order builtin callbacks like map/filter).
 */
function executeVM(
  startChunk: Chunk,
  startUpvalues: UpvalueCell[],
  runtime: VMRuntime,
  initialStack?: KValue[],
  initialStackBase?: number,
): Effect.Effect<VMRunResult, KernelError> {
  return Effect.gen(function* () {
    const stack: KValue[] = initialStack ?? [];
    const frames: CallFrame[] = [];
    const { builtins, globals, stepLimit } = runtime;
    const stepCounter = runtime.stepCounter;

    if (!initialStack) {
      // Pre-fill local slots for top-level chunk
      for (let i = 0; i < startChunk.localCount; i++) {
        stack.push(null);
      }
    }

    let frame: CallFrame = {
      chunk: startChunk,
      upvalues: startUpvalues,
      ip: 0,
      stackBase: initialStackBase ?? 0,
    };

    function readU16(): number {
      const code = frame.chunk.code;
      const val = (code[frame.ip]! << 8) | code[frame.ip + 1]!;
      frame.ip += 2;
      return val;
    }

    function readI16(): number {
      const val = readU16();
      return val > 0x7fff ? val - 0x10000 : val;
    }

    function readU8(): number {
      return frame.chunk.code[frame.ip++]!;
    }

    function currentTrace() {
      const traceIndex = Math.max(frame.ip - 1, 0);
      return frame.chunk.traces[traceIndex];
    }

    function errorContext() {
      const trace = currentTrace();
      return {
        ...(trace?.loc ? { loc: trace.loc } : {}),
        ...(trace?.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
      };
    }

    function stackFrame(name: string, trace?: SourceTrace): KernelStackFrame {
      return {
        name,
        ...(trace?.loc ? { loc: trace.loc } : {}),
        ...(trace?.macroOrigins ? { macroOrigins: trace.macroOrigins } : {}),
      };
    }

    function currentStackTrace(): readonly KernelStackFrame[] {
      return [
        stackFrame(frame.chunk.name, currentTrace()),
        ...frames
          .slice()
          .reverse()
          .map((callFrame) =>
            stackFrame(
              callFrame.chunk.name,
              callFrame.callTrace ?? callFrame.chunk.traces[Math.max(callFrame.ip - 1, 0)],
            ),
          ),
      ];
    }

    function sameLoc(left?: KernelStackFrame["loc"], right?: KernelStackFrame["loc"]): boolean {
      if (!left || !right) return left === right;
      return (
        left.start === right.start &&
        left.end === right.end &&
        left.line === right.line &&
        left.col === right.col
      );
    }

    function sameMacroOrigins(
      left?: KernelStackFrame["macroOrigins"],
      right?: KernelStackFrame["macroOrigins"],
    ): boolean {
      if (!left || !right) return left === right;
      if (left.length !== right.length) return false;
      return left.every((origin, index) => {
        const other = right[index];
        return (
          other !== undefined &&
          origin.macroName === other.macroName &&
          sameLoc(origin.loc, other.loc)
        );
      });
    }

    function sameStackFrame(left: KernelStackFrame, right: KernelStackFrame): boolean {
      return (
        left.name === right.name &&
        sameLoc(left.loc, right.loc) &&
        sameMacroOrigins(left.macroOrigins, right.macroOrigins)
      );
    }

    function mergeStackTrace(
      existing: readonly KernelStackFrame[] | undefined,
      next: readonly KernelStackFrame[],
    ): readonly KernelStackFrame[] {
      const merged = existing ? [...existing] : [];
      for (const frame of next) {
        if (merged.length > 0 && sameStackFrame(merged[merged.length - 1]!, frame)) continue;
        merged.push(frame);
      }
      return merged;
    }

    function withStackTrace(error: KernelError): KernelError {
      const mergedStackTrace = mergeStackTrace(
        "stackTrace" in error ? error.stackTrace : undefined,
        currentStackTrace(),
      );

      switch (error._tag) {
        case "KernelTypeError":
          return new KernelTypeError({
            message: error.message,
            expected: error.expected,
            got: error.got,
            ...(error.loc ? { loc: error.loc } : {}),
            ...(error.macroOrigins ? { macroOrigins: error.macroOrigins } : {}),
            stackTrace: mergedStackTrace,
          });
        case "ArityError":
          return new ArityError({
            name: error.name,
            expected: error.expected,
            got: error.got,
            ...(error.loc ? { loc: error.loc } : {}),
            ...(error.macroOrigins ? { macroOrigins: error.macroOrigins } : {}),
            stackTrace: mergedStackTrace,
          });
        case "StepLimitExceeded":
          return new StepLimitExceeded({
            limit: error.limit,
            ...(error.loc ? { loc: error.loc } : {}),
            ...(error.macroOrigins ? { macroOrigins: error.macroOrigins } : {}),
            stackTrace: mergedStackTrace,
          });
        case "FailError":
          return new FailError({
            message: error.message,
            ...(error.loc ? { loc: error.loc } : {}),
            ...(error.macroOrigins ? { macroOrigins: error.macroOrigins } : {}),
            stackTrace: mergedStackTrace,
          });
      }
    }

    function expectNumber(value: KValue, context: string): number | KernelTypeError {
      try {
        return asNumber(value, context);
      } catch (error) {
        if (error instanceof TypeCheckError) {
          return new KernelTypeError({
            message: error.message,
            expected: error.expected,
            got: error.got,
            ...errorContext(),
          });
        }
        throw error;
      }
    }

    while (true) {
      const totalSteps = yield* Ref.updateAndGet(stepCounter, (count) => count + 1);
      if (stepLimit > 0 && totalSteps > stepLimit) {
        return yield* withStackTrace(
          new StepLimitExceeded({ limit: stepLimit, ...errorContext() }),
        );
      }

      const code = frame.chunk.code;
      if (frame.ip >= code.length) {
        return { value: null, steps: totalSteps };
      }
      const op = code[frame.ip++]!;

      switch (op) {
        // ── Stack ──────────────────────────────────────────
        case Op.CONST:
          stack.push(frame.chunk.constants[readU16()]! as KValue);
          break;

        case Op.NIL:
          stack.push(null);
          break;
        case Op.TRUE:
          stack.push(true);
          break;
        case Op.FALSE:
          stack.push(false);
          break;
        case Op.POP:
          stack.pop();
          break;

        // ── Variables ──────────────────────────────────────
        case Op.LOAD_LOCAL:
          stack.push(stack[frame.stackBase + readU8()]!);
          break;

        case Op.STORE_LOCAL: {
          const slot = readU8();
          stack[frame.stackBase + slot] = stack[stack.length - 1]!;
          break;
        }

        case Op.LOAD_UPVALUE:
          stack.push(frame.upvalues[readU8()]!.value);
          break;

        case Op.STORE_UPVALUE: {
          const idx = readU8();
          frame.upvalues[idx]!.value = stack[stack.length - 1]!;
          break;
        }

        case Op.LOAD_GLOBAL: {
          const idx = readU16();
          const val = globals[idx];
          if (val === undefined && runtime.strictGlobals === true) {
            const name = runtime.globalNames?.[idx] ?? `<global:${idx}>`;
            return yield* withStackTrace(
              new KernelTypeError({
                message: `Unbound symbol: ${name}`,
                expected: "bound value",
                got: "undefined",
                ...errorContext(),
              }),
            );
          }
          stack.push(val === undefined ? null : val);
          break;
        }

        case Op.STORE_GLOBAL: {
          const idx = readU16();
          globals[idx] = stack[stack.length - 1]!;
          break;
        }

        // ── Closures ───────────────────────────────────────
        case Op.CLOSURE: {
          const funcIdx = readU16();
          const upvalueCount = readU8();
          const funcChunk = frame.chunk.functions[funcIdx]!;
          const upvalues: UpvalueCell[] = [];
          for (let i = 0; i < upvalueCount; i++) {
            const isLocal = readU8();
            const index = readU8();
            if (isLocal) {
              upvalues.push({ value: stack[frame.stackBase + index]! });
            } else {
              upvalues.push(frame.upvalues[index]!);
            }
          }
          stack.push(makeVMKFn(funcChunk, upvalues));
          break;
        }

        // ── Function calls ─────────────────────────────────
        case Op.CALL: {
          const argc = readU8();
          const calleePos = stack.length - 1 - argc;
          const callee = stack[calleePos]!;
          const vmData = getVMClosure(callee);

          if (vmData) {
            if (!hasValidArity(vmData.chunk, argc)) {
              return yield* withStackTrace(
                new ArityError({
                  name: vmData.chunk.name,
                  expected: expectedArity(vmData.chunk),
                  got: argc,
                  ...errorContext(),
                }),
              );
            }
            const callTrace = currentTrace();
            frames.push({ ...frame, ...(callTrace ? { callTrace } : {}) });
            const newBase = calleePos + 1;
            if (vmData.chunk.variadic) {
              const restArgs = stack.slice(newBase + vmData.chunk.arity, newBase + argc);
              stack.length = newBase + vmData.chunk.arity;
              stack.push(restArgs);
            }
            for (
              let i = vmData.chunk.arity + (vmData.chunk.variadic ? 1 : 0);
              i < vmData.chunk.localCount;
              i++
            ) {
              stack.push(null);
            }
            frame = { chunk: vmData.chunk, upvalues: vmData.upvalues, ip: 0, stackBase: newBase };
          } else if (isKFn(callee) && callee.apply) {
            const args: KValue[] = [];
            for (let i = 0; i < argc; i++) args.push(stack[calleePos + 1 + i]!);
            stack.length = calleePos;
            const result = yield* applyKFnValue(callee, args, runtime).pipe(
              Effect.mapError(withStackTrace),
            );
            stack.push(result);
          } else {
            return yield* withStackTrace(
              new KernelTypeError({
                message: `Cannot call ${typeof callee} as function`,
                expected: "function",
                got: typeof callee,
                ...errorContext(),
              }),
            );
          }
          break;
        }

        case Op.TAIL_CALL: {
          const argc = readU8();
          const calleePos = stack.length - 1 - argc;
          const callee = stack[calleePos]!;
          const vmData = getVMClosure(callee);

          if (vmData) {
            if (!hasValidArity(vmData.chunk, argc)) {
              return yield* withStackTrace(
                new ArityError({
                  name: vmData.chunk.name,
                  expected: expectedArity(vmData.chunk),
                  got: argc,
                  ...errorContext(),
                }),
              );
            }
            const argsStart = calleePos + 1;
            const callArgs = stack.slice(argsStart, argsStart + argc);
            for (let i = 0; i < argc; i++) {
              if (i >= vmData.chunk.arity && vmData.chunk.variadic) break;
              stack[frame.stackBase + i] = callArgs[i]!;
            }
            if (vmData.chunk.variadic) {
              stack[frame.stackBase + vmData.chunk.arity] = callArgs.slice(vmData.chunk.arity);
            }
            stack.length = frame.stackBase + vmData.chunk.localCount;
            for (
              let i = vmData.chunk.arity + (vmData.chunk.variadic ? 1 : 0);
              i < vmData.chunk.localCount;
              i++
            ) {
              stack[frame.stackBase + i] = null;
            }
            frame = {
              chunk: vmData.chunk,
              upvalues: vmData.upvalues,
              ip: 0,
              stackBase: frame.stackBase,
            };
          } else if (isKFn(callee) && callee.apply) {
            // Non-VM tail call: fall back to regular call
            const args: KValue[] = [];
            for (let i = 0; i < argc; i++) args.push(stack[calleePos + 1 + i]!);
            stack.length = calleePos;
            const result = yield* applyKFnValue(callee, args, runtime).pipe(
              Effect.mapError(withStackTrace),
            );
            stack.push(result);
          } else {
            return yield* withStackTrace(
              new KernelTypeError({
                message: `Cannot tail-call ${typeof callee} as function`,
                expected: "function",
                got: typeof callee,
                ...errorContext(),
              }),
            );
          }
          break;
        }

        case Op.RETURN: {
          const result = stack.length > frame.stackBase ? stack.pop()! : null;
          stack.length = frame.stackBase;
          if (frames.length === 0) {
            return { value: result, steps: totalSteps };
          }
          frame = frames.pop()!;
          stack.pop(); // pop callee
          stack.push(result);
          break;
        }

        // ── Inline arithmetic ──────────────────────────────
        case Op.ADD: {
          const b = expectNumber(stack.pop()!, "+");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "+");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a + b);
          break;
        }
        case Op.SUB: {
          const b = expectNumber(stack.pop()!, "-");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "-");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a - b);
          break;
        }
        case Op.MUL: {
          const b = expectNumber(stack.pop()!, "*");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "*");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a * b);
          break;
        }
        case Op.DIV: {
          const b = expectNumber(stack.pop()!, "/");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "/");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(b === 0 ? Infinity : a / b);
          break;
        }
        case Op.MOD: {
          const b = expectNumber(stack.pop()!, "mod");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "mod");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a % b);
          break;
        }
        case Op.NEGATE:
          stack[stack.length - 1] = -(stack[stack.length - 1] as number);
          break;

        // ── Inline comparison ──────────────────────────────
        case Op.EQ: {
          const b = stack.pop()!;
          const a = stack.pop()!;
          stack.push(kEquals(a, b));
          break;
        }
        case Op.LT: {
          const b = expectNumber(stack.pop()!, "<");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "<");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a < b);
          break;
        }
        case Op.GT: {
          const b = expectNumber(stack.pop()!, ">");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, ">");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a > b);
          break;
        }
        case Op.LTE: {
          const b = expectNumber(stack.pop()!, "<=");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, "<=");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a <= b);
          break;
        }
        case Op.GTE: {
          const b = expectNumber(stack.pop()!, ">=");
          if (b instanceof KernelTypeError) return yield* withStackTrace(b);
          const a = expectNumber(stack.pop()!, ">=");
          if (a instanceof KernelTypeError) return yield* withStackTrace(a);
          stack.push(a >= b);
          break;
        }
        case Op.NOT:
          stack[stack.length - 1] = !isTruthy(stack[stack.length - 1]!);
          break;

        // ── Control flow ───────────────────────────────────
        case Op.JUMP: {
          const joff = readI16();
          frame.ip += joff;
          break;
        }

        case Op.JUMP_IF_FALSE: {
          const offset = readI16();
          if (!isTruthy(stack.pop()!)) frame.ip += offset;
          break;
        }

        case Op.JUMP_IF_TRUE: {
          const offset = readI16();
          if (isTruthy(stack.pop()!)) frame.ip += offset;
          break;
        }

        case Op.MATCH_FAILURE:
          throw new KernelTypeError({message:"No pattern matched the value",expected:"matching pattern",got:"unmatched value",...(currentTrace() ? {loc:currentTrace()!.loc} : {})});

        case Op.MATCH: {
          const pattern = frame.chunk.constants[readU16()] as CompiledMatchPattern;
          const bindingCount = readU8();
          const bindingSlots = new Array<number>(bindingCount);
          for (let i = 0; i < bindingCount; i++) {
            bindingSlots[i] = readU8();
          }

          const scrutinee = stack.pop()!;
          const bindings = matchCompiledPattern(pattern, scrutinee, name => { const index = runtime.globalNames?.indexOf(`__constructor/${name}`) ?? -1; return index < 0 ? undefined : runtime.globals[index]; });
          if (bindings === null) {
            stack.push(false);
            break;
          }

          for (let i = 0; i < bindingCount; i++) {
            stack[frame.stackBase + bindingSlots[i]!] = bindings[i] ?? null;
          }
          stack.push(true);
          break;
        }

        // ── Collections ────────────────────────────────────
        case Op.MAKE_LIST: {
          const n = readU16();
          const items: KValue[] = new Array(n);
          for (let i = n - 1; i >= 0; i--) items[i] = stack.pop()!;
          stack.push(Object.freeze(items) as readonly KValue[]);
          break;
        }

        case Op.MAKE_MAP: {
          const n = readU16();
          const map = new Map<string, KValue>();
          const pairs: [string, KValue][] = new Array(n);
          for (let i = n - 1; i >= 0; i--) {
            const val = stack.pop()!;
            const rawKey = stack.pop()!;
            const key = mapKey(rawKey);
            if (key === undefined) return yield* new KernelTypeError({message:"Map keys must be strings, keywords or symbols",expected:"map key",got:typeof rawKey});
            pairs[i] = [key, val];
          }
          for (const [key, val] of pairs) map.set(key, val);
          stack.push(map as ReadonlyMap<string, KValue>);
          break;
        }

        case Op.GET: {
          const key = stack.pop()!;
          const coll = stack.pop()!;
          if (coll instanceof Map) stack.push(coll.get(mapKey(key) ?? "") ?? null);
          else if (Array.isArray(coll)) stack.push(coll[key as number] ?? null);
          else stack.push(null);
          break;
        }

        case Op.QUASIQUOTE: {
          const template = frame.chunk.constants[readU16()] as SExpr;
          const closureCount = readU8();
          const closures: KValue[] = new Array(closureCount);
          for (let i = closureCount - 1; i >= 0; i--) {
            closures[i] = stack.pop()!;
          }
          let closureIndex = 0;
          const expanded = yield* evalQuasiquoteTemplate(template, (_kind, loc) => {
            const closure = closures[closureIndex++];
            if (closure === undefined) {
              return Effect.fail(
                new KernelTypeError({
                  message: "quasiquote placeholder closure missing",
                  expected: "compiled unquote closure",
                  got: "missing closure",
                  loc,
                }),
              );
            }
            return applyCallableValue(closure, [], runtime).pipe(Effect.mapError(withStackTrace));
          }).pipe(Effect.mapError(withStackTrace));
          stack.push({ _tag: "KSExpr", expr: expanded });
          break;
        }

        // ── Builtins bridge ────────────────────────────────
        case Op.CALL_BUILTIN: {
          const builtinIdx = readU16();
          const argc = readU8();
          const args: KValue[] = new Array(argc);
          for (let i = argc - 1; i >= 0; i--) args[i] = stack.pop()!;
          const builtin = builtins[builtinIdx];
          if (!builtin) {
            return yield* withStackTrace(
              new KernelTypeError({
                message: `Unknown builtin at index ${builtinIdx}`,
                expected: "builtin function",
                got: "undefined",
                ...errorContext(),
              }),
            );
          }
          // applyFn for higher-order builtins (map, filter, reduce)
          const applyFn = (
            fn: KValue,
            fnArgs: readonly KValue[],
          ): Effect.Effect<KValue, KernelError> => applyCallableValue(fn, fnArgs, runtime);
          const result = yield* builtin(args, applyFn).pipe(Effect.mapError(withStackTrace));
          stack.push(result);
          break;
        }

        case Op.REGISTER_INSTANCE: {
          const className = frame.chunk.constants[readU16()] as string;
          const typeName = canonicalRuntimeTypeName(frame.chunk.constants[readU16()] as string);
          const methodCount = readU8();
          const methods: Array<{ name: string; globalIdx: number }> = [];
          for (let i = 0; i < methodCount; i++) {
            methods.push({
              name: frame.chunk.constants[readU16()] as string,
              globalIdx: readU16(),
            });
          }

          const methodValues: KFn[] = new Array(methodCount);
          for (let i = methodCount - 1; i >= 0; i--) {
            const methodValue = stack.pop()!;
            if (!isKFn(methodValue)) {
              return yield* withStackTrace(
                new KernelTypeError({
                  message: `Instance method '${methods[i]!.name}' must evaluate to a function`,
                  expected: "function",
                  got: typeof methodValue,
                  ...errorContext(),
                }),
              );
            }
            methodValues[i] = methodValue;
          }

          for (let i = 0; i < methodCount; i++) {
            const method = methods[i]!;
            const methodValue = methodValues[i]!;
            const vmData = getVMClosure(methodValue);
            const dispatchArgIndex = vmData
              ? vmData.chunk.arity >= 2
                ? 1
                : 0
              : methodValue.params.length >= 2
                ? 1
                : 0;
            const existingData = getDispatchWrapperData(globals[method.globalIdx]);
            if (
              existingData &&
              existingData.methodName === method.name &&
              existingData.className === className &&
              existingData.dispatchArgIndex === dispatchArgIndex
            ) {
              existingData.implementations.set(typeName, methodValue);
            } else {
              const implementations = new Map<string, KFn>([[typeName, methodValue]]);
              globals[method.globalIdx] = makeDispatchWrapper(
                method.name,
                className,
                dispatchArgIndex,
                implementations,
              );
            }
          }

          stack.push(null);
          break;
        }

        case Op.OBSERVE: {
          const target = readU16();
          runtime.observer?.observe(target, stack[stack.length - 1] ?? null);
          yield* Ref.update(stepCounter, (count) => count - 1);
          break;
        }

        default:
          return yield* withStackTrace(
            new KernelTypeError({
              message: `Unknown opcode: ${op}`,
              expected: "valid opcode",
              got: String(op),
              ...errorContext(),
            }),
          );
      }
    }
  });
}

/**
 * Run a VM closure with given arguments. Used by higher-order builtins
 * (map, filter, reduce) and by the apply override on VMKFn.
 */
function runClosure(
  vmData: VMClosureData,
  args: KValue[],
  runtime: VMRuntime,
): Effect.Effect<KValue, KernelError> {
  const chunk = vmData.chunk;
  if (!hasValidArity(chunk, args.length)) {
    return Effect.fail(
      new ArityError({
        name: chunk.name,
        expected: expectedArity(chunk),
        got: args.length,
      }),
    );
  }

  // Build the initial stack: [callee, arg0, arg1, ..., null, null, ...]
  const stack: KValue[] = [null]; // placeholder for callee (popped on RETURN)
  for (let i = 0; i < chunk.arity; i++) {
    stack.push(args[i]!);
  }
  if (chunk.variadic) {
    stack.push(args.slice(chunk.arity));
  }
  for (let i = chunk.arity + (chunk.variadic ? 1 : 0); i < chunk.localCount; i++) {
    stack.push(null);
  }

  return executeVM(
    chunk,
    vmData.upvalues,
    runtime,
    stack,
    1, // stackBase: after the callee placeholder
  ).pipe(Effect.map((result) => result.value));
}
