export { Op, type Chunk, newChunk } from "./opcodes.js";
export { compileProgram, GlobalRegistry, BuiltinRegistry, type CompileResult } from "./compiler.js";
export {
  runChunk,
  runChunkWithStats,
  currentBuiltinCallLoc,
  VMExecutionControlScope,
  type VMClosureData,
  type VMExecutionControl,
  type VMOptions,
  type VMRunResult,
  getVMClosure,
} from "./vm.js";
