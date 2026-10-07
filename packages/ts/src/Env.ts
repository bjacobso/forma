import type { KValue } from "./evaluator/types.js";

/**
 * Immutable lexical scope chain.
 *
 * `bindMutable` creates a slot that can be updated after creation — used by
 * `define` so a function's closure can reference itself for recursion.
 */
export class Env {
  private readonly bindings: Map<string, KValue>;
  private readonly parent: Env | null;

  private constructor(bindings: Map<string, KValue>, parent: Env | null) {
    this.bindings = bindings;
    this.parent = parent;
  }

  static empty(): Env {
    return new Env(new Map(), null);
  }

  static from(record: Record<string, KValue>): Env {
    return new Env(new Map(Object.entries(record)), null);
  }

  lookup(name: string): KValue | undefined {
    const val = this.bindings.get(name);
    if (val !== undefined) return val;
    // Check for explicit null binding
    if (this.bindings.has(name)) return null;
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  bindingNames(): readonly string[] {
    const names = this.parent ? [...this.parent.bindingNames()] : [];
    for (const name of this.bindings.keys()) {
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }

  bind(name: string, value: KValue): Env {
    const newBindings = new Map(this.bindings);
    newBindings.set(name, value);
    return new Env(newBindings, this.parent);
  }

  /**
   * Create a child env with a mutable slot. Returns the new env and a setter
   * that mutates the slot in place — used for recursive `define` bindings.
   */
  bindMutable(name: string, initial: KValue): { env: Env; set: (value: KValue) => void } {
    const childMap = new Map<string, KValue>();
    childMap.set(name, initial);
    const childEnv = new Env(childMap, this);
    return {
      env: childEnv,
      set: (value: KValue) => {
        childMap.set(name, value);
      },
    };
  }

  extend(bindings: Record<string, KValue>): Env {
    return new Env(new Map(Object.entries(bindings)), this);
  }

  /** One frame holding every binding visible here, innermost first. */
  flatten(): Env {
    const bindings = new Map<string, KValue>();
    for (let env: Env | null = this; env; env = env.parent) {
      for (const [name, value] of env.bindings) if (!bindings.has(name)) bindings.set(name, value);
    }
    return new Env(bindings, null);
  }

  /**
   * Return a copy of this env with a new parent. Used to chain prelude
   * macros beneath a user-provided environment.
   */
  withParent(parent: Env): Env {
    return new Env(new Map(this.bindings), parent);
  }
}
