/**
 * ElaborationRegistry — pluggable registry of elaboration hooks.
 *
 * Replaces the monolithic bridge handler system with composable,
 * phase-specific hooks. Each form can have up to 4 hooks:
 * bindings, validate, construct, result-type.
 */

import { Effect } from "effect";
import type {
  ElaborationHook,
  HookInput,
  HookOutput,
  BindingMap,
  Diagnostic,
  ElaborationError,
} from "./ElaborationHook.js";
import type { Type } from "../type/types.js";

export class ElaborationRegistry {
  private readonly hooks = new Map<string, ElaborationHook>();

  fork(): ElaborationRegistry {
    const child = new ElaborationRegistry();
    for (const [name, hook] of this.hooks) child.hooks.set(name,hook);
    return child;
  }

  registerHook(hook: ElaborationHook): void {
    this.hooks.set(hook.name, hook);
  }

  getHook(name: string): ElaborationHook | undefined {
    return this.hooks.get(name);
  }

  hasHook(name: string): boolean {
    return this.hooks.has(name);
  }

  /** Get all hooks registered for a specific form (supports both hyphen and slash naming) */
  getHooksForForm(formName: string): readonly ElaborationHook[] {
    const hyphenPrefix = `${formName}-`;
    const slashPrefix = `${formName}/`;
    return [...this.hooks.values()].filter(
      (h) => h.name.startsWith(hyphenPrefix) || h.name.startsWith(slashPrefix),
    );
  }

  /** Execute a named hook */
  execute(name: string, input: HookInput): Effect.Effect<HookOutput, ElaborationError> {
    const hook = this.hooks.get(name);
    if (!hook) {
      return Effect.fail(
        new (class extends Error {
          readonly _tag = "ElaborationError" as const;
          readonly hookName = name;
          readonly phase = "construct" as const;
          constructor() {
            super(`Elaboration hook not found: ${name}`);
          }
        })() as unknown as ElaborationError,
      );
    }
    return hook.execute(input);
  }

  // --- Phase-specific convenience methods ---

  computeBindings(hookName: string, input: HookInput): Effect.Effect<BindingMap, ElaborationError> {
    return Effect.flatMap(this.execute(hookName, input), (output) => {
      if (output.kind !== "bindings") {
        return Effect.fail(
          new (class extends Error {
            readonly _tag = "ElaborationError" as const;
            readonly hookName = hookName;
            readonly phase = "bindings" as const;
            constructor() {
              super(`Hook ${hookName} returned ${output.kind}, expected bindings`);
            }
          })() as unknown as ElaborationError,
        );
      }
      return Effect.succeed(output.bindings);
    });
  }

  validate(
    hookName: string,
    input: HookInput,
  ): Effect.Effect<readonly Diagnostic[], ElaborationError> {
    return Effect.flatMap(this.execute(hookName, input), (output) => {
      if (output.kind !== "validate") {
        return Effect.fail(
          new (class extends Error {
            readonly _tag = "ElaborationError" as const;
            readonly hookName = hookName;
            readonly phase = "validate" as const;
            constructor() {
              super(`Hook ${hookName} returned ${output.kind}, expected validate`);
            }
          })() as unknown as ElaborationError,
        );
      }
      return Effect.succeed(output.diagnostics);
    });
  }

  construct(hookName: string, input: HookInput): Effect.Effect<unknown, ElaborationError> {
    return Effect.flatMap(this.execute(hookName, input), (output) => {
      if (output.kind !== "construct") {
        return Effect.fail(
          new (class extends Error {
            readonly _tag = "ElaborationError" as const;
            readonly hookName = hookName;
            readonly phase = "construct" as const;
            constructor() {
              super(`Hook ${hookName} returned ${output.kind}, expected construct`);
            }
          })() as unknown as ElaborationError,
        );
      }
      return Effect.succeed(output.ir);
    });
  }

  computeResultType(hookName: string, input: HookInput): Effect.Effect<Type, ElaborationError> {
    return Effect.flatMap(this.execute(hookName, input), (output) => {
      if (output.kind !== "result-type") {
        return Effect.fail(
          new (class extends Error {
            readonly _tag = "ElaborationError" as const;
            readonly hookName = hookName;
            readonly phase = "result-type" as const;
            constructor() {
              super(`Hook ${hookName} returned ${output.kind}, expected result-type`);
            }
          })() as unknown as ElaborationError,
        );
      }
      return Effect.succeed(output.type);
    });
  }
}
