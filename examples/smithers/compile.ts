import { bootstrapFromSources, elaborateProgram } from "@formalang/ts/descriptor";
import { parse } from "@formalang/ts/engine";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Codec = { tag: string; fields?: Record<string, Codec>; members?: Codec[]; item?: Codec; value?: Json };
export interface Schemas { payload: Codec; success: Codec; error: Codec }
export interface ActionIR {
  kind: "Action"; name: string; tier: "sealed" | "compensable" | "irreversible";
  capabilities: string[]; reads: string[]; writes: string[];
  attempts: number; "timeout-ms": number; version: string; key?: string; schemas: Schemas;
}
export interface NodeIR { kind: string; name: string; data: Record<string, Json> }
export interface WorkflowIR {
  kind: "Workflow"; name: string; capabilities: string[]; reads: string[]; writes: string[];
  tier: ActionIR["tier"]; "deadline-ms": number; "max-rounds": number;
  return: string; nodes: NodeIR[]; schemas: Schemas;
}
export interface NativeFlowIR { kind: "NativeFlow"; name: string; capabilities: string[]; schemas: Schemas }
export interface Program { actions: ActionIR[]; workflows: WorkflowIR[]; nativeFlows: NativeFlowIR[] }

/** Run exactly the descriptor path used by the shared playground. */
export function compile(prelude: string, source: string): Program {
  const diagnostics = [
    ...parse({ sourceId: "prelude.forma", source: prelude }).diagnostics,
    ...parse({ sourceId: "example.forma", source }).diagnostics,
  ];
  if (diagnostics.some(d => d.severity === "error")) throw new Error(JSON.stringify(diagnostics));
  const result = elaborateProgram(source, {
    prelude: bootstrapFromSources("", prelude), sourceId: "example.forma",
  });
  if (result.diagnostics.some(d => d.severity === "error")) throw new Error(JSON.stringify(result.diagnostics));
  const declarations = result.declarations.map(d => d.payload) as unknown as (ActionIR | WorkflowIR | NativeFlowIR)[];
  return {
    actions: declarations.filter((d): d is ActionIR => d.kind === "Action"),
    workflows: declarations.filter((d): d is WorkflowIR => d.kind === "Workflow"),
    nativeFlows: declarations.filter((d): d is NativeFlowIR => d.kind === "NativeFlow"),
  };
}
