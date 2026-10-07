/**
 * What a document sees from the preludes loaded before it: their macros,
 * the types of their definitions, and the forms their descriptors describe.
 *
 * Preludes are analyzed in load order. Each one is typed in the scope the
 * preludes before it produce, so an open prelude is analyzed exactly as it
 * contributes to the documents after it.
 */

import { Effect } from "effect";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
import type { Env } from "../Env.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import { analyzeLsp, type LspResult } from "../lsp/hm-lsp.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { MakeInferContextOptions } from "../type/context.js";
import type { DSLTypeProvider } from "../type/dsl-provider.js";
import type { TypeEnv } from "../type/substitution.js";
import { descriptorFormProvider } from "../type/unified-form-provider.js";

export interface SourceText {
  readonly sourceId: string;
  readonly text: string;
}

/** The names, macros, and forms visible to a source. */
export interface Scope {
  /** Types of the names earlier preludes define. */
  readonly typeEnv: TypeEnv;
  /** Macros earlier preludes define; `undefined` when there are none. */
  readonly macroEnv: Env | undefined;
  /** Types applications of the forms the preludes' descriptors describe. */
  readonly formProvider: DSLTypeProvider | undefined;
  /** Descriptors and hooks of every prelude. */
  readonly prelude: BootstrappedPrelude | undefined;
}

/** One prelude, typed in the scope of the preludes before it. */
export interface PreludeLayer {
  readonly sourceId: string;
  readonly before: Scope;
  readonly analysis: LspResult;
}

export interface PreludeScopes {
  readonly layers: readonly PreludeLayer[];
  /** The scope after every prelude: what documents see. */
  readonly scope: Scope;
}

export const emptyScope: Scope = {
  typeEnv: new Map(),
  macroEnv: undefined,
  formProvider: undefined,
  prelude: undefined,
};

/** Analyze preludes in load order and return the scope each one produces. */
export function buildPreludeScopes(
  preludes: readonly SourceText[],
  inferOptions: MakeInferContextOptions | undefined,
): PreludeScopes {
  if (preludes.length === 0) return { layers: [], scope: emptyScope };
  const prelude = bootstrapPreludes(preludes);
  const formProvider = prelude ? descriptorFormProvider(prelude) : undefined;
  let scope: Scope = { ...emptyScope, formProvider, prelude };
  const layers: PreludeLayer[] = [];
  for (const source of preludes) {
    const before = scope;
    let typeEnv = before.typeEnv;
    const analysis = Effect.runSync(
      analyzeLsp(source.text, {
        ...analyzeOptions(before, inferOptions),
        captureEnv: (env) => {
          typeEnv = env;
        },
      }),
    );
    layers.push({ sourceId: source.sourceId, before, analysis });
    scope = { ...before, typeEnv, macroEnv: extendMacros(before.macroEnv, source.text) };
  }
  return { layers, scope };
}

/** Options that analyze a source in a scope. */
export function analyzeOptions(
  scope: Scope,
  inferOptions: MakeInferContextOptions | undefined,
): Parameters<typeof analyzeLsp>[1] {
  return {
    initialEnv: scope.typeEnv,
    ...(scope.macroEnv ? { macroEnv: scope.macroEnv } : {}),
    ...(scope.formProvider ? { dslProvider: scope.formProvider } : {}),
    ...(inferOptions ? { inferOptions } : {}),
  };
}

function bootstrapPreludes(preludes: readonly SourceText[]): BootstrappedPrelude | undefined {
  try {
    return bootstrapFromSources("", "", ...preludes.map((source) => source.text));
  } catch {
    // A prelude that is being written may not bootstrap. Its documents are
    // still typed, without its forms.
    return undefined;
  }
}

/**
 * The macros visible after a source: the earlier macros plus the source's
 * own. The result is one flat frame, because the expander re-parents the
 * environment it is given and so keeps only its first frame.
 */
function extendMacros(previous: Env | undefined, text: string): Env | undefined {
  const { redTree, errors } = parse(text);
  if (errors.length > 0) return previous;
  try {
    const { macroEnv } = expandKernelExprsSync(toSExprMany(redTree), {
      ...(previous ? { env: previous } : {}),
    });
    return macroEnv.flatten();
  } catch {
    return previous;
  }
}
