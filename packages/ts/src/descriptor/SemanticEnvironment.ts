/**
 * SimpleSemanticEnvironment — concrete implementation of SemanticEnvironment.
 *
 * Global declaration facts live in shared state.
 * Lexical bindings and local declarations live in an explicit scope stack so
 * compiler phases and meta hooks can ask the same scoped semantic questions.
 */

import { lowerMembers } from "../surface/members.js";
import { Effect, Layer } from "effect";
import type { SExpr } from "../reader/types.js";
import { InferContext, makeInferContext } from "../type/context.js";
import { resetNodeIds } from "../type/core-expr.js";
import { inferProgram } from "../type/infer.js";
import { lowerProgram } from "../type/lower.js";
import { mono, type Type } from "../type/types.js";
import type {
  ExpressionTypeResult,
  SemanticEnvironment,
  SemanticFactValue,
  DeclaredName,
} from "./ElaborationHook.js";

interface SharedSemanticState {
  readonly facts: Map<string, Map<string, SemanticFactValue>>;
  readonly factSets: Map<string, Map<string, Set<string>>>;
  readonly declarations: Map<string, DeclaredName>;
  readonly globalBindings: Map<string, Type>;
}

interface ScopeFrame {
  readonly declarations: Map<string, DeclaredName>;
  readonly bindings: Map<string, Type>;
}

function createSharedState(): SharedSemanticState {
  return {
    facts: new Map(),
    factSets: new Map(),
    declarations: new Map(),
    globalBindings: new Map(),
  };
}

function createScopeFrame(): ScopeFrame {
  return {
    declarations: new Map(),
    bindings: new Map(),
  };
}

export class SimpleSemanticEnvironment implements SemanticEnvironment {
  constructor(
    private readonly shared: SharedSemanticState = createSharedState(),
    private readonly frames: readonly ScopeFrame[] = [],
  ) {}

  // --- Scope management ---

  childScope(): SimpleSemanticEnvironment {
    return new SimpleSemanticEnvironment(this.shared, [...this.frames, createScopeFrame()]);
  }

  bind(name: string, type: Type): void {
    const frame = this.currentFrame();
    if (frame) {
      frame.bindings.set(name, type);
      return;
    }
    this.shared.globalBindings.set(name, type);
  }

  declareGlobal(name: string, formName: string, type?: Type): void {
    const entry: DeclaredName = type !== undefined ? { name, formName, type } : { name, formName };
    this.shared.declarations.set(name, entry);
    if (type !== undefined) {
      this.shared.globalBindings.set(name, type);
    }
  }

  // --- Consumer-owned semantic facts ---

  setFact(kind: string, key: string, value: SemanticFactValue): void {
    let facts = this.shared.facts.get(kind);
    if (!facts) {
      facts = new Map();
      this.shared.facts.set(kind, facts);
    }
    facts.set(key, value);
  }

  getFact(kind: string, key: string): SemanticFactValue | undefined {
    return this.shared.facts.get(kind)?.get(key);
  }

  addFactSetValue(kind: string, key: string, value: string): void {
    let factSet = this.shared.factSets.get(kind);
    if (!factSet) {
      factSet = new Map();
      this.shared.factSets.set(kind, factSet);
    }
    let values = factSet.get(key);
    if (!values) {
      values = new Set();
      factSet.set(key, values);
    }
    values.add(value);
  }

  getFactSet(kind: string, key: string): readonly string[] {
    return [...(this.shared.factSets.get(kind)?.get(key) ?? new Set<string>())];
  }

  declare(name: string, formName: string, type?: Type): void {
    const entry: DeclaredName = type !== undefined ? { name, formName, type } : { name, formName };
    const frame = this.currentFrame();
    if (frame) {
      frame.declarations.set(name, entry);
      if (type !== undefined) {
        frame.bindings.set(name, type);
      }
      return;
    }

    this.shared.declarations.set(name, entry);
    if (type !== undefined) {
      this.shared.globalBindings.set(name, type);
    }
  }

  // --- SemanticEnvironment interface ---

  getDeclaredNames(): ReadonlyMap<string, DeclaredName> {
    const visible = new Map(this.shared.declarations);
    for (const frame of this.frames) {
      for (const [name, declaration] of frame.declarations) {
        visible.set(name, declaration);
      }
    }
    return visible;
  }

  getBindingType(name: string): Type | undefined {
    for (let index = this.frames.length - 1; index >= 0; index--) {
      const frame = this.frames[index]!;
      const localBinding = frame.bindings.get(name);
      if (localBinding !== undefined) return localBinding;

      const localDeclaration = frame.declarations.get(name)?.type;
      if (localDeclaration !== undefined) return localDeclaration;
    }

    return (
      this.shared.globalBindings.get(name) ??
      this.shared.declarations.get(name)?.type ??
      getTypedFact(this.shared.facts, "binding-type", name)
    );
  }

  getVisibleBindings(): ReadonlyMap<string, Type> {
    const bindings = new Map<string, Type>();

    for (const [name, declaration] of this.shared.declarations) {
      if (declaration.type !== undefined) {
        bindings.set(name, declaration.type);
      }
    }

    for (const [name, type] of this.shared.globalBindings) {
      bindings.set(name, type);
    }

    for (const frame of this.frames) {
      for (const [name, declaration] of frame.declarations) {
        if (declaration.type !== undefined) {
          bindings.set(name, declaration.type);
        }
      }
      for (const [name, type] of frame.bindings) {
        bindings.set(name, type);
      }
    }

    return bindings;
  }

  inferExpression(expr: SExpr): ExpressionTypeResult {
    try {
      resetNodeIds();
      const coreExprs = lowerProgram([lowerMembers(expr,new Set(this.getVisibleBindings().keys()))]);
      const initialEnv = new Map(
        [...this.getVisibleBindings()].map(([name, type]) => [name, mono(type)] as const),
      );
      const ctxService = Effect.runSync(makeInferContext());
      const layer = Layer.succeed(InferContext, ctxService);
      const type = Effect.runSync(
        Effect.provide(inferProgram(coreExprs, initialEnv, undefined, [expr]), layer),
      );
      return { _tag: "success", type };
    } catch (error) {
      return {
        _tag: "failure",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  inferExpressionType(expr: SExpr): Type | undefined {
    const result = this.inferExpression(expr);
    return result._tag === "success" ? result.type : undefined;
  }

  private currentFrame(): ScopeFrame | undefined {
    return this.frames[this.frames.length - 1];
  }
}

function getTypedFact(
  facts: Map<string, Map<string, SemanticFactValue>>,
  kind: string,
  key: string,
): Type | undefined {
  const value = facts.get(kind)?.get(key);
  return isType(value) ? value : undefined;
}

function isType(value: SemanticFactValue | undefined): value is Type {
  return (
    !!value &&
    typeof value === "object" &&
    "_tag" in value &&
    typeof (value as { _tag?: unknown })._tag === "string"
  );
}
