/**
 * Bytecode opcodes and chunk representation for the Lisp VM.
 *
 * The VM uses a stack-based architecture. Each Chunk is a compiled function
 * body containing bytecode, a constant pool, and nested function chunks.
 */

import type { CompiledMatchPattern } from "../evaluator/match.js";
import type { KValue } from "../evaluator/types.js";
import type { SourceTrace } from "../evaluator/source-trace.js";
import type { SExpr } from "../reader/index.js";

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

export enum Op {
  // ── Stack manipulation ──────────────────────────────────
  /** Push constants[u16] onto the stack */
  CONST = 0,
  /** Push null */
  NIL = 1,
  /** Push true */
  TRUE = 2,
  /** Push false */
  FALSE = 3,
  /** Discard top of stack */
  POP = 4,

  // ── Variable access ─────────────────────────────────────
  /** Push locals[u8] (stack-relative to frame base) */
  LOAD_LOCAL = 10,
  /** Pop → locals[u8] */
  STORE_LOCAL = 11,
  /** Push closure.upvalues[u8] */
  LOAD_UPVALUE = 12,
  /** Pop → closure.upvalues[u8] */
  STORE_UPVALUE = 13,
  /** Push globals[u16] */
  LOAD_GLOBAL = 14,
  /** Pop → globals[u16] */
  STORE_GLOBAL = 15,

  // ── Functions ───────────────────────────────────────────
  /**
   * CLOSURE u16 u8
   * Build closure from functions[u16] with u8 upvalue captures.
   * Followed by u8 pairs of (isLocal:u8, index:u8).
   */
  CLOSURE = 20,
  /** CALL u8 — call function on stack with u8 args */
  CALL = 21,
  /** TAIL_CALL u8 — reuse current frame (TCO) */
  TAIL_CALL = 22,
  /** Return top of stack to caller */
  RETURN = 23,

  // ── Inline arithmetic (no builtin dispatch) ─────────────
  /** pop b, pop a, push a + b */
  ADD = 30,
  /** pop b, pop a, push a - b */
  SUB = 31,
  /** pop b, pop a, push a * b */
  MUL = 32,
  /** pop b, pop a, push a / b */
  DIV = 33,
  /** pop b, pop a, push a % b */
  MOD = 34,
  /** push -top */
  NEGATE = 35,

  // ── Inline comparison ───────────────────────────────────
  /** Structural equality */
  EQ = 40,
  /** pop b, pop a, push a < b */
  LT = 41,
  /** pop b, pop a, push a > b */
  GT = 42,
  /** pop b, pop a, push a <= b */
  LTE = 43,
  /** pop b, pop a, push a >= b */
  GTE = 44,
  /** push !isTruthy(top) */
  NOT = 45,

  // ── Control flow ────────────────────────────────────────
  /** JUMP i16 — signed offset from current ip */
  JUMP = 50,
  /** JUMP_IF_FALSE i16 — pop, jump if falsy */
  JUMP_IF_FALSE = 51,
  /** JUMP_IF_TRUE i16 — pop, jump if truthy */
  JUMP_IF_TRUE = 52,
  /**
   * MATCH u16 u8 [u8]×N
   * pattern_const, binding_count, then one local slot per binding.
   * Pops scrutinee, writes matched bindings into locals, pushes boolean.
   */
  MATCH = 53,
  /** Raise a located error after every match arm fails. */
  MATCH_FAILURE = 54,

  // ── Collections ─────────────────────────────────────────
  /** MAKE_LIST u16 — pop u16 items, push frozen array */
  MAKE_LIST = 60,
  /** MAKE_MAP u16 — pop u16 key/value pairs, push ReadonlyMap */
  MAKE_MAP = 61,
  /** GET — pop key, pop collection, push result */
  GET = 62,
  /** QUASIQUOTE u16 u8 — template constant plus N zero-arg closures */
  QUASIQUOTE = 63,

  // ── Builtins bridge ─────────────────────────────────────
  /** CALL_BUILTIN u16 u8 — call builtins[u16] with u8 args from stack */
  CALL_BUILTIN = 70,

  /**
   * REGISTER_INSTANCE u16 u16 u8 [u16 u16]×N
   * class_name_const, type_name_const, method_count,
   * then for each method: method_name_const, global_index.
   * Pops N method functions, registers dispatch implementations, stores
   * dispatch wrappers into the referenced globals, and pushes nil.
   */
  REGISTER_INSTANCE = 83,

  // ── Tooling ─────────────────────────────────────────────
  /**
   * OBSERVE u16 — report the top of the stack to the observer as target u16.
   * Emitted only when an evaluation is observed. Does not count as a step.
   */
  OBSERVE = 90,
}

// ---------------------------------------------------------------------------
// Chunk — compiled function body
// ---------------------------------------------------------------------------

export interface Chunk {
  /** Bytecode instructions */
  readonly code: number[];
  /** Literal/constant pool */
  readonly constants: ChunkConstant[];
  /** Nested function bodies */
  readonly functions: Chunk[];
  /** Source line mapping: code offset → line number */
  readonly lines: number[];
  /** Source trace mapping: code offset → source loc + macro provenance */
  readonly traces: (SourceTrace | undefined)[];
  /** Number of parameters (0 for top-level) */
  readonly arity: number;
  /** Whether the function accepts a variadic rest argument */
  readonly variadic: boolean;
  /** Number of upvalues this function captures */
  readonly upvalueCount: number;
  /** Debug name (for stack traces) */
  readonly name: string;
  /** Total number of local variable slots needed */
  readonly localCount: number;
}

export type ChunkConstant = KValue | CompiledMatchPattern | SExpr;

export function newChunk(name: string, arity: number, variadic: boolean = false): Chunk {
  return {
    code: [],
    constants: [],
    functions: [],
    lines: [],
    traces: [],
    arity,
    variadic,
    upvalueCount: 0,
    localCount: arity + (variadic ? 1 : 0),
    name,
  };
}

// ---------------------------------------------------------------------------
// Bytecode emit helpers
// ---------------------------------------------------------------------------

/** Append a single opcode */
export function emit(chunk: Chunk, op: Op, trace?: SourceTrace): void {
  (chunk.code as number[]).push(op);
  (chunk.lines as number[]).push(trace?.loc.line ?? 0);
  (chunk.traces as (SourceTrace | undefined)[]).push(trace);
}

/** Append a u8 operand */
export function emitU8(chunk: Chunk, val: number, trace?: SourceTrace): void {
  (chunk.code as number[]).push(val & 0xff);
  (chunk.lines as number[]).push(trace?.loc.line ?? 0);
  (chunk.traces as (SourceTrace | undefined)[]).push(trace);
}

/** Append a u16 operand (big-endian) */
export function emitU16(chunk: Chunk, val: number, trace?: SourceTrace): void {
  (chunk.code as number[]).push((val >> 8) & 0xff, val & 0xff);
  (chunk.lines as number[]).push(trace?.loc.line ?? 0, trace?.loc.line ?? 0);
  (chunk.traces as (SourceTrace | undefined)[]).push(trace, trace);
}

/** Add a constant to the pool, return its index */
export function addConstant(chunk: Chunk, value: ChunkConstant): number {
  // Deduplicate primitives
  for (let i = 0; i < chunk.constants.length; i++) {
    const c = chunk.constants[i];
    if (c === value) return i;
  }
  const idx = chunk.constants.length;
  (chunk.constants as ChunkConstant[]).push(value);
  return idx;
}

/**
 * Emit a jump instruction. Returns the offset of the placeholder
 * so it can be patched later with patchJump().
 */
export function emitJump(chunk: Chunk, op: Op, trace?: SourceTrace): number {
  emit(chunk, op, trace);
  const offset = chunk.code.length;
  emitU16(chunk, 0, trace); // placeholder
  return offset;
}

/**
 * Patch a previously emitted jump placeholder with the actual offset.
 * The offset is relative: how far to jump from the instruction after the operand.
 */
export function patchJump(chunk: Chunk, placeholderOffset: number): void {
  const jump = chunk.code.length - (placeholderOffset + 2); // +2 for the u16 operand itself
  (chunk.code as number[])[placeholderOffset] = (jump >> 8) & 0xff;
  (chunk.code as number[])[placeholderOffset + 1] = jump & 0xff;
}
