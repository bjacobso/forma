import { Effect } from "effect";
import type { ParseError, SExpr } from "../reader/index.js";
import { parseManyToSExpr } from "../reader/index.js";
import { defaultBuiltins } from "../builtins/index.js";
import { Env } from "../Env.js";
import type { KernelError } from "../diagnostic/errors.js";
import {
  expandProgramSync,
  getPreludeEnvSync,
  type ExpandProgramOptions,
} from "../expander/expand.js";
import { PreludeEnv } from "../expander/prelude.js";
import type { BuiltinFn } from "./types.js";

export interface KernelFrontendOptions extends Omit<
  ExpandProgramOptions,
  "builtins" | "env" | "includePrelude"
> {
  readonly builtins?: Record<string, BuiltinFn> | undefined;
  readonly env?: Env | undefined;
  readonly includePrelude?: boolean | undefined;
  readonly preludeEnv?: Env | undefined;
}

export interface KernelFrontendResult {
  readonly exprs: readonly SExpr[];
  readonly expanded: readonly SExpr[];
  readonly macroEnv: Env;
  readonly expansionEnv: Env;
}

export function buildKernelExpansionEnv(options: KernelFrontendOptions = {}): Env {
  const builtins = options.builtins ?? defaultBuiltins;
  const baseEnv =
    options.includePrelude === false
      ? undefined
      : (options.preludeEnv ?? getPreludeEnvSync(builtins));

  if (!options.env) {
    return baseEnv ?? Env.empty();
  }

  return baseEnv ? options.env.withParent(baseEnv) : options.env;
}

export function expandKernelExprsSync(
  exprs: readonly SExpr[],
  options: KernelFrontendOptions = {},
): KernelFrontendResult {
  const builtins = options.builtins ?? defaultBuiltins;
  const expansionEnv = buildKernelExpansionEnv(options);
  const result = expandProgramSync(exprs, {
    builtins,
    env: expansionEnv,
    includePrelude: false,
    ...(options.inlineCompileTimeCalls === true ? { inlineCompileTimeCalls: true } : {}),
    ...(options.keepMacroDefs === true ? { keepMacroDefs: true } : {}),
    ...(options.macroStepLimit !== undefined ? { macroStepLimit: options.macroStepLimit } : {}),
    ...(options.onExpansionFailure ? { onExpansionFailure: options.onExpansionFailure } : {}),
  });

  return {
    exprs,
    expanded: result.exprs,
    macroEnv: result.env,
    expansionEnv,
  };
}

export function expandKernelExprs(
  exprs: readonly SExpr[],
  options: KernelFrontendOptions = {},
): Effect.Effect<KernelFrontendResult, KernelError, PreludeEnv> {
  return Effect.gen(function* () {
    const preludeEnv =
      options.includePrelude === false ? undefined : (options.preludeEnv ?? (yield* PreludeEnv));
    return expandKernelExprsSync(exprs, { ...options, preludeEnv });
  });
}

export function parseAndExpandKernelSource(
  source: string,
  options: KernelFrontendOptions = {},
): Effect.Effect<KernelFrontendResult, ParseError | KernelError, PreludeEnv> {
  return Effect.gen(function* () {
    const exprs = yield* parseManyToSExpr(source);
    return yield* expandKernelExprs(exprs, options);
  });
}
