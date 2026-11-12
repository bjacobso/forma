import { Effect } from "effect";
import { analyzeLsp, type LspResult } from "../lsp/hm-lsp.js";
import { builtinScheme } from "../type/builtin-schemes.js";
import type { TypeEnv } from "../type/substitution.js";
import { showScheme } from "../type/types.js";

/** Display queries only: these strings must never become inference schemes. */
export interface BindingQueries {
  /**
   * Mechanics bindings take precedence over HM bindings, then builtins.
   * An offset belongs to this analysis's source; inside a mechanics-owned
   * expression, an absent mechanics binding never falls back to an HM name.
   * Lexical expression types remain available through typedSpans/typeAt.
   */
  readonly bindingDisplay: (name: string, offset?: number) => string | undefined;
  /** Names supplied by either checker or by the builtin environment. */
  readonly hasBinding: (name: string) => boolean;
}

/** Keep raw environment capture and HM formatting inside the analysis adapter. */
export function analyzeBindings(
  sourceId: string,
  text: string,
  options: Parameters<typeof analyzeLsp>[1],
): { readonly result: LspResult; readonly bindings: BindingQueries } {
  let env: TypeEnv = options?.initialEnv ?? new Map();
  const result = Effect.runSync(analyzeLsp(text, {
    ...options,
    sourceId,
    captureEnv: captured => { env = captured; },
  }));
  // Prelude bindings are visible, but their offsets belong to other sources.
  const mechanicsSpans = result.mechanics?.typedSpans.filter(s => s.span.sourceId === sourceId) ?? [];
  const spans = [
    ...mechanicsSpans.map(s => ({ start: s.span.startOffset, end: s.span.endOffset, mechanics: true })),
    ...result.typedSpans.map(s => ({ start: s.span.start, end: s.span.end, mechanics: false })),
  ];
  const mechanics = result.mechanics?.bindingTypes;
  return { result, bindings: {
    bindingDisplay(name, offset) {
      const display = mechanics?.get(name);
      if (display !== undefined) return display;
      if (offset !== undefined) {
        let found: typeof spans[number] | undefined;
        for (const span of spans) {
          if (span.start <= offset && offset < span.end &&
              (!found || span.end - span.start < found.end - found.start)) found = span;
        }
        if (found?.mechanics) return undefined;
      }
      const scheme = env.get(name) ?? builtinScheme(name);
      return scheme ? showScheme(scheme) : undefined;
    },
    hasBinding: name => mechanics?.has(name) === true || env.has(name) || builtinScheme(name) !== undefined,
  } };
}
