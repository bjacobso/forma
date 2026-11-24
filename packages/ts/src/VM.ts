/**
 * Bytecode compiler and virtual machine executor.
 *
 * @module VM
 */

export { Op, type Chunk, newChunk } from "./vm/opcodes.js";
export {
  compileProgram,
  GlobalRegistry,
  BuiltinRegistry,
  type CompileResult,
} from "./vm/compiler.js";
export {
  runChunk,
  runChunkWithStats,
  currentBuiltinCallLoc,
  type VMClosureData,
  type VMOptions,
  type VMRunResult,
  getVMClosure,
} from "./vm/vm.js";
