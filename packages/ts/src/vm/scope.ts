/**
 * Compile scope — tracks locals and upvalue captures, registries, and context.
 */

import type { KernelObserver } from "../evaluator/observation.js";
import type { Env } from "../Env.js";
import type { BuiltinFn } from "../evaluator/types.js";

// ---------------------------------------------------------------------------
// Local / Upvalue interfaces
// ---------------------------------------------------------------------------

export interface Local {
  name: string;
  slot: number;
  isCaptured: boolean;
}

export interface Upvalue {
  /** Index into enclosing scope's locals or upvalues */
  index: number;
  /** true = captured from direct parent's locals, false = transitive upvalue */
  isLocal: boolean;
}

// ---------------------------------------------------------------------------
// CompileScope
// ---------------------------------------------------------------------------

export class CompileScope {
  readonly locals: Local[] = [];
  readonly upvalues: Upvalue[] = [];
  readonly parent: CompileScope | null;
  private nextSlot: number;

  constructor(parent: CompileScope | null, reservedSlots: number = 0) {
    this.parent = parent;
    this.nextSlot = reservedSlots;
  }

  addLocal(name: string): number {
    const slot = this.nextSlot++;
    this.locals.push({ name, slot, isCaptured: false });
    return slot;
  }

  resolveLocal(name: string): number {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i]!.name === name) return this.locals[i]!.slot;
    }
    return -1;
  }

  resolveUpvalue(name: string): number {
    if (!this.parent) return -1;

    // Check parent's locals
    const local = this.parent.resolveLocal(name);
    if (local !== -1) {
      // Mark parent's local as captured
      for (const l of this.parent.locals) {
        if (l.slot === local) l.isCaptured = true;
      }
      return this.addUpvalue(local, true);
    }

    // Check parent's upvalues (transitive capture)
    const upvalue = this.parent.resolveUpvalue(name);
    if (upvalue !== -1) {
      return this.addUpvalue(upvalue, false);
    }

    return -1;
  }

  private addUpvalue(index: number, isLocal: boolean): number {
    // Deduplicate
    for (let i = 0; i < this.upvalues.length; i++) {
      const uv = this.upvalues[i]!;
      if (uv.index === index && uv.isLocal === isLocal) return i;
    }
    const idx = this.upvalues.length;
    this.upvalues.push({ index, isLocal });
    return idx;
  }

  get localCount(): number {
    return this.nextSlot;
  }
}

// ---------------------------------------------------------------------------
// Global name registry — shared across a compilation unit
// ---------------------------------------------------------------------------

export class GlobalRegistry {
  private readonly names: string[] = [];
  private readonly map = new Map<string, number>();

  has(name: string): boolean {
    return this.map.has(name);
  }

  resolve(name: string): number {
    const existing = this.map.get(name);
    if (existing !== undefined) return existing;
    const idx = this.names.length;
    this.names.push(name);
    this.map.set(name, idx);
    return idx;
  }

  get count(): number {
    return this.names.length;
  }

  nameAt(idx: number): string | undefined {
    return this.names[idx];
  }
}

// ---------------------------------------------------------------------------
// Builtin registry — maps builtin names to indices for CALL_BUILTIN
// ---------------------------------------------------------------------------

export class BuiltinRegistry {
  private readonly names: string[] = [];
  private readonly map = new Map<string, number>();

  constructor(builtins: Record<string, BuiltinFn>) {
    for (const name of Object.keys(builtins)) {
      this.map.set(name, this.names.length);
      this.names.push(name);
    }
  }

  resolve(name: string): number {
    return this.map.get(name) ?? -1;
  }

  nameAt(idx: number): string | undefined {
    return this.names[idx];
  }

  /** Ordered list of builtin functions for the VM */
  toArray(builtins: Record<string, BuiltinFn>): BuiltinFn[] {
    return this.names.map((n) => builtins[n]!);
  }

  toMap(builtins: Record<string, BuiltinFn>): ReadonlyMap<string, BuiltinFn> {
    return new Map(this.names.map((name) => [name, builtins[name]!] as const));
  }
}

export interface CompileContext {
  readonly env?: Env;
  /** When present, observed expressions are followed by `OBSERVE`. */
  readonly observer?: KernelObserver;
}
