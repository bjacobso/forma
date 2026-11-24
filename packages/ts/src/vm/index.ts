export { Op, type Chunk, newChunk } from "./opcodes.js";
export { compileProgram, GlobalRegistry, BuiltinRegistry, type CompileResult } from "./compiler.js";
export {
  runChunk,
  runChunkWithStats,
  currentBuiltinCallLoc,
  type VMClosureData,
  type VMOptions,
  type VMRunResult,
  getVMClosure,
} from "./vm.js";
