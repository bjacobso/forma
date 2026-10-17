/** Experimental MCP tools → checked Forma services. This is not a sandbox. */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "@formalang/ts/artifact";
import { isKFloat, KFloat } from "@formalang/ts/evaluator";
import {
  elaborateEffectProgram, makeMechanicsRuntime, MechanicsRuntimeError,
  type EffectProgramDiagnostic, type MechanicsServiceMethod,
} from "@formalang/ts/mechanics";
import { asSchema, assertMcpIdentifier, mcpSchemaType, type McpJsonSchema } from "./mcp-schema.js";

export { mcpSchemaType } from "./mcp-schema.js";

export interface McpToolBinding {
  readonly tool: Tool;
  readonly capability: string;
  readonly inputType: string;
  readonly outputType: string;
  readonly errorType: string;
}

export interface McpServiceBinding {
  readonly service: string;
  readonly prelude: string;
  readonly tools: readonly McpToolBinding[];
}

/** Explicit selection makes unsupported discovery schemas visible, never silently Any. */
export async function discoverMcpService(
  client: Pick<Client, "listTools">,
  options: { readonly service: string; readonly tools: readonly string[] },
): Promise<McpServiceBinding> {
  const tools: Tool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? {} : { cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor !== undefined && cursors.has(cursor)) throw new Error("MCP tools/list repeated a cursor");
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
  return compileMcpService(tools, options);
}

export function compileMcpService(
  tools: readonly Tool[],
  options: { readonly service: string; readonly tools: readonly string[] },
): McpServiceBinding {
  assertMcpIdentifier(options.service);
  if (new Set(options.tools).size !== options.tools.length) throw new Error("Duplicate MCP tool selection");
  const selected = options.tools.map((name): McpToolBinding => {
    assertMcpIdentifier(name);
    const matches = tools.filter((tool) => tool.name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one discovered MCP tool: ${name}`);
    const tool = structuredClone(matches[0]!);
    const prefix = `${options.service}_${name}`;
    return {
      tool, capability: `${options.service}.${name}`,
      inputType: `${prefix}_Input`, outputType: tool.outputSchema ? `${prefix}_Output` : "Json",
      errorType: `${prefix}_Failed`,
    };
  });
  const declarations = selected.flatMap(({ tool, inputType, outputType, errorType }) => [
    `(type ${inputType} ${mcpSchemaType(tool.inputSchema)})`,
    ...(tool.outputSchema ? [`(type ${outputType} ${mcpSchemaType(tool.outputSchema)})`] : []),
    `(error ${errorType} {:message String})`,
  ]);
  declarations.push(`(service ${options.service}\n${selected.map((item) =>
    `  (: ${item.tool.name} (-> ${item.inputType} (Effect ${item.outputType} [${item.errorType}] [])))`,
  ).join("\n")}\n)`);
  const prelude = `${declarations.join("\n")}\n`;
  const checked = elaborateEffectProgram(prelude, { sourceId: "mcp-generated.forma" });
  if (!checked.ok) throw new Error(`Invalid generated MCP prelude: ${JSON.stringify(checked.diagnostics)}`);
  return { service: options.service, prelude, tools: selected };
}

export interface McpCallStep {
  readonly capability: string;
  readonly arguments: JsonValue;
  readonly outcome: { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly error: JsonValue };
}

export type McpRunResult = {
  readonly calls: readonly McpCallStep[];
  readonly requirements: readonly string[];
} & (
  | { readonly status: "completed"; readonly value: JsonValue }
  | { readonly status: "error"; readonly error: JsonValue }
  | { readonly status: "failed"; readonly diagnostics: readonly EffectProgramDiagnostic[] }
);

/**
 * Runs a zero-argument entry after checking the whole source. Grants come from
 * the embedding host; source cannot grant itself capabilities. Only exact
 * capabilities in the entry's R are installed. The mechanics interpreter has
 * no VM instruction budget; maxCalls bounds external calls only.
 */
export async function runMcpProgram(
  client: Pick<Client, "callTool">,
  binding: McpServiceBinding,
  request: {
    readonly source: string;
    readonly sourceId?: string;
    readonly entry: string;
    readonly grants: readonly string[];
    readonly maxCalls?: number;
  },
): Promise<McpRunResult> {
  const calls: McpCallStep[] = [];
  const requirements: string[] = [];
  const fail = (code: string, message: string): McpRunResult => ({
    status: "failed", calls, requirements,
    diagnostics: [{ code, message, severity: "error", phase: "check" }],
  });
  const maxCalls = request.maxCalls ?? 100;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0) return fail("mcp/invalid-budget", "maxCalls must be a nonnegative safe integer");
  const sourceId = request.sourceId ?? "agent.forma";
  const combined = binding.prelude + request.source;
  const checked = elaborateEffectProgram(combined, { sourceId });
  if (!checked.ok) {
    // The existing elaborator takes one source. Keep author spans relative to
    // the submitted source when prepending the generated prelude.
    const offset = binding.prelude.length;
    const lines = binding.prelude.split("\n").length - 1;
    return { status: "failed", calls, requirements, diagnostics: checked.diagnostics.map((diagnostic) => {
      const span = diagnostic.span;
      return span && span.startOffset >= offset ? { ...diagnostic, span: {
        ...span, startOffset: span.startOffset - offset, endOffset: span.endOffset - offset,
        startLine: span.startLine - lines, endLine: span.endLine - lines,
      } } : diagnostic;
    }) };
  }
  const entry = checked.check!.operations.get(request.entry);
  if (!entry) return fail("mcp/unknown-entry", `No Effect operation named ${request.entry}`);
  if (entry.params.length) return fail("mcp/entry-arity", "The prototype entry must take zero arguments");
  // The portable interpreter does not execute general value applications.
  // Reject them before I/O rather than return their syntax as a value.
  for (const declaration of checked.declarations) {
    const payload = asSchema(declaration.payload);
    if (payload.kind !== "EffectDef") continue;
    const unsupported = unsupportedRuntimeNode(payload.body);
    if (unsupported) return fail("mcp/unsupported-runtime-node", `The MCP prototype cannot execute ${unsupported} nodes`);
  }
  requirements.push(...entry.result.requirements.keys());
  const available = new Map(binding.tools.map((tool) => [tool.capability, tool]));
  for (const capability of requirements) {
    if (!available.has(capability) || !request.grants.includes(capability)) {
      return fail("mcp/ungranted-capability", `Host has not granted ${capability}`);
    }
  }
  const methods: Record<string, MechanicsServiceMethod> = Object.create(null);
  let startedCalls = 0;
  for (const capability of requirements) {
    const item = available.get(capability)!;
    // SDK Tool schemas allow optional properties explicitly set to undefined;
    // the validator's JSONSchema type uses exact optional keys instead.
    // Isolate schema caches: two tools may reuse a $id for different schemas.
    const validateInput = new AjvJsonSchemaValidator().getValidator(item.tool.inputSchema as JsonSchemaType);
    const validateOutput = item.tool.outputSchema ? new AjvJsonSchemaValidator().getValidator(item.tool.outputSchema as JsonSchemaType) : undefined;
    methods[item.tool.name] = async (...args) => {
      if (startedCalls >= maxCalls) throw new MechanicsRuntimeError("mcp/call-budget", "MCP call budget exhausted");
      const input = toJson(args[0]);
      try {
        if (args.length !== 1) throw new Error("Expected one MCP argument record");
        const validation = validateInput(input);
        if (!validation.valid) throw new Error(`MCP input schema: ${validation.errorMessage}`);
        startedCalls++;
        const result = await client.callTool({ name: item.tool.name, arguments: asSchema(input) });
        if (result.isError) throw new Error(JSON.stringify(result.content));
        const value = item.tool.outputSchema ? result.structuredContent : result;
        if (validateOutput) {
          const validation = validateOutput(value);
          if (!validation.valid) throw new Error(`MCP output schema: ${validation.errorMessage}`);
        }
        const json = toJson(value);
        const runtimeValue = fromJson(json, item.tool.outputSchema);
        calls.push({ capability, arguments: input, outcome: { ok: true, value: json } });
        return runtimeValue;
      } catch (cause) {
        const error = { _tag: item.errorType, message: cause instanceof Error ? cause.message : String(cause) };
        calls.push({ capability, arguments: input, outcome: { ok: false, error } });
        throw new MechanicsRuntimeError(`mcp/tool-failed`, error.message, undefined, item.errorType, error);
      }
    };
  }
  try {
    const runtime = makeMechanicsRuntime({ declarations: checked.declarations, services: { [binding.service]: methods } });
    return { status: "completed", value: toJson(await runtime.invoke(request.entry)), calls, requirements };
  } catch (cause) {
    if (cause instanceof MechanicsRuntimeError && cause.errorType) {
      return { status: "error", error: toJson(cause.errorValue), calls, requirements };
    }
    return fail(cause instanceof MechanicsRuntimeError ? cause.code : "mcp/runtime", cause instanceof Error ? cause.message : String(cause));
  }
}

const runtimeNodes = new Set([
  "OperationCall", "ServiceCall", "Succeed", "Fail", "Catch", "Do", "Bind",
  "Let", "If", "When", "Unless", "Cond", "Pure", "Literal", "Var", "Vector", "Record", "Error",
]);

function unsupportedRuntimeNode(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const unsupported = unsupportedRuntimeNode(item);
      if (unsupported) return unsupported;
    }
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "Expr") {
      const source = asSchema(record.source);
      return ["Symbol", "Number", "String", "Bool"].includes(String(source.kind)) ? undefined : `Expr/${String(source.kind)}`;
    }
    if (typeof record.kind === "string" && !runtimeNodes.has(record.kind)) return record.kind;
    for (const [key, item] of Object.entries(record)) {
      if (key === "effect" || key === "span") continue;
      const unsupported = unsupportedRuntimeNode(item);
      if (unsupported) return unsupported;
    }
  }
  return undefined;
}

function toJson(value: unknown): JsonValue {
  if (isKFloat(value)) return toJson(value.value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  throw new Error("MCP boundary requires a JSON value");
}

function fromJson(value: JsonValue, schema?: McpJsonSchema): unknown {
  if (schema?.type === "integer" && typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("MCP integer output is outside Forma's safe integer range");
  }
  if (schema?.type === "number" && typeof value === "number") return new KFloat(value);
  if (Array.isArray(value)) return value.map((item) => fromJson(item, schema?.items as McpJsonSchema | undefined));
  if (value !== null && typeof value === "object") {
    const properties = schema?.properties as Record<string, McpJsonSchema> | undefined;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromJson(item, properties?.[key])]));
  }
  return value;
}
