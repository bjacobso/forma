import { Context } from "effect";
import type { Env } from "../Env.js";
import { preludeSources } from "../preludes/sources.generated.js";

/** Kernel macros are shared by runtime evaluation and hosted projections. */
export class PreludeEnv extends Context.Service<PreludeEnv, Env>()("PreludeEnv") {}

export const PRELUDE_SOURCE = preludeSources["kernel.lisp"];
