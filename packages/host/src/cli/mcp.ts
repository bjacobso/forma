/** Agent-oriented stdio tools. stdout belongs exclusively to the MCP transport. */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { diagnosticCatalog, diagnosticFromUnknown } from "@formalang/ts/diagnostic";
import { formatLispSource } from "@formalang/ts/formatter";
import { ModuleError, resolveModuleGraph } from "@formalang/ts/modules";
import { nodeModuleResolver, readFormaManifest, readVendoredPackages, type NodePackages } from "@formalang/ts/node";
import { Effect } from "effect";
import { JsonAbi } from "../json-abi.js";
import type { EvaluationState } from "../types.js";
import { withFileSession } from "./file.js";

const failed = (code: string, message: string) => ({ ok: false, diagnostics: [{ code, severity: "error" as const, message }] });
const hasErrors = (diagnostics: readonly { severity: string }[]) => diagnostics.some(d => d.severity === "error");
const string = { type: "string" };
const sourceProperties = { path: string, source: string, sourceId: string };
const sourceChoice = { oneOf: [{ required: ["path"], not: { required: ["source"] } }, { required: ["source"], not: { required: ["path"] } }] };
function input(properties: Record<string, object>, required: string[] = [], extra: Record<string, unknown> = {}): Tool["inputSchema"] {
  return { type: "object", properties, required, additionalProperties: false, ...extra };
}

export async function mcp(abi = new JsonAbi()): Promise<void> {
  const root = realpathSync(process.cwd());
  function confined(path: string): string {
    const absolute = resolve(root, path);
    const inside = (candidate: string) => {
      const rel = relative(root, candidate);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path leaves the MCP server working directory.");
    };
    inside(absolute);
    const canonical = realpathSync(absolute);
    inside(canonical);
    return canonical;
  }
  // Bound project discovery and local package dependencies before Node helpers read them.
  function packagesFor(path: string): NodePackages | undefined {
    for (let directory = dirname(path); ; directory = dirname(directory)) {
      if (existsSync(join(directory, "forma.json"))) {
        const visited = new Set<string>();
        const visit = (dir: string) => {
          dir = confined(dir);
          if (visited.has(dir)) return;
          visited.add(dir);
          confined(join(dir, "forma.json"));
          const manifest = readFormaManifest(dir);
          for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
            visit(spec.startsWith("./") || spec.startsWith("../") ? resolve(dir, spec) : join(directory, "vendor", ...name.split("/")));
          }
        };
        visit(directory);
        if (existsSync(join(directory, "forma.lock"))) confined(join(directory, "forma.lock"));
        if (existsSync(join(directory, "vendor"))) confined(join(directory, "vendor"));
        return readVendoredPackages(directory);
      }
      if (directory === root) return undefined;
    }
  }
  async function checked(source: { source?: string; sourceId?: string; sessionId?: string }) {
    const response = await abi.handleJson(JSON.stringify({ op: "typecheck", ...source }));
    return { ok: response.ok, ...(response.type ? { type: response.type } : {}), diagnostics: response.diagnostics };
  }
  async function checkOrRun(name: string, args: Record<string, any>): Promise<Record<string, unknown>> {
    const execute = async (request: { source?: string; sourceId?: string; sessionId?: string }) => {
      const check = await checked(request);
      if (name === "check") return check;
      if (!check.ok) return { ...check, value: null, printed: null, type: check.type ?? null };
      const state: EvaluationState = request.sessionId
        ? await abi.host.evaluateInSession({ ...request, sessionId: request.sessionId, stepLimit: args.stepLimit })
        : { status: "completed", result: await abi.host.evaluate({ source: request.source!, sourceId: request.sourceId, stepLimit: args.stepLimit }) };
      if (state.status === "failed") return { ok: false, value: null, printed: null, type: check.type ?? null, diagnostics: [...check.diagnostics, ...state.diagnostics] };
      if (state.status === "host-call") return { ...failed("abi/invalid-request", "MCP evaluation does not grant host capabilities."), value: null, printed: null, type: check.type ?? null };
      const diagnostics = [...check.diagnostics, ...state.result.diagnostics];
      return { ok: !hasErrors(diagnostics), value: hasErrors(diagnostics) ? null : state.result.value, printed: hasErrors(diagnostics) ? null : state.result.printed ?? null, type: check.type ?? null, diagnostics };
    };
    if (args.path === undefined) return execute({ source: args.source, sourceId: args.sourceId ?? "source" });
    const path = confined(args.path);
    const packages = packagesFor(path);
    const packageResolver = nodeModuleResolver(packages);
    const graph = resolveModuleGraph({ id: path, source: readFileSync(path, "utf8") }, (specifier, importer) => {
      if (importer.startsWith("pkg:")) return packageResolver(specifier, importer);
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
      try {
        const id = confined(resolve(dirname(importer), specifier));
        return { id, source: readFileSync(id, "utf8") };
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) return undefined;
        throw error;
      }
    }, packages ? { packages: packages.table } : {});
    const result = await withFileSession(abi, graph, packages, sessionId => execute({ sessionId, sourceId: graph.entry }));
    return name === "run" ? { value: null, printed: null, type: null, ...result } : { ...result };
  }

  const scriptDocument = await abi.host.editScriptSchema() as { schema: Record<string, unknown>; definitions: Record<string, unknown> };
  const tools: Tool[] = [
    { name: "check", description: "Typecheck source or a file module graph; preserve diagnostics, spans, help and fixes.", inputSchema: input(sourceProperties, [], sourceChoice) },
    { name: "run", description: "Check first, then evaluate with no host capabilities. Never evaluate a failed check.", inputSchema: input({ ...sourceProperties, stepLimit: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, [], sourceChoice) },
    { name: "format", description: "Format source. Write only with an existing path and write: true.", inputSchema: input({ ...sourceProperties, write: { type: "boolean" } }, [], { ...sourceChoice, if: { properties: { write: { const: true } }, required: ["write"] }, then: { required: ["path"] } }) },
    { name: "explain", description: "Look up a diagnostic code in the offline catalog.", inputSchema: input({ code: string }, ["code"]) },
    { name: "describe_nodes", description: "Identify and describe every syntax node. Ids refer to this exact source; describe again after editing.", inputSchema: input({ source: string }, ["source"]) },
    { name: "edit", description: "Apply an id-addressed edit script to source, then check the new source. Does not write files.", inputSchema: input({ source: string, script: scriptDocument.schema }, ["source", "script"], { $defs: scriptDocument.definitions }) },
  ];
  // TODO(describe): wire the host describe operation here when it is available.
  const validator = new AjvJsonSchemaValidator();
  const validators = new Map(tools.map(tool => [tool.name, validator.getValidator<Record<string, any>>(tool.inputSchema as JsonSchemaType)]));
  const version = await abi.host.version();
  const server = new Server({ name: "forma", version: version.engineVersion }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    let result: Record<string, unknown>;
    try {
      const validate = validators.get(params.name);
      if (!validate) result = failed("abi/unsupported-op", `Unknown tool ${params.name}.`);
      else {
        const validated = validate(params.arguments ?? {});
        if (!validated.valid) result = failed("abi/invalid-request", validated.errorMessage);
        else {
          const args = validated.data;
          if (params.name === "check" || params.name === "run") result = await checkOrRun(params.name, args);
          else if (params.name === "format") {
            const path = args.path === undefined ? undefined : confined(args.path);
            const source = path === undefined ? args.source : readFileSync(path, "utf8");
            const formatted = await Effect.runPromise(Effect.result(formatLispSource(source)));
            if (formatted._tag === "Failure") result = { ok: false, diagnostics: [diagnosticFromUnknown(formatted.failure, "parse", path ?? args.sourceId ?? "source")] };
            else {
              if (args.write) writeFileSync(path!, formatted.success);
              result = { ok: true, source: formatted.success, diagnostics: [] };
            }
          } else if (params.name === "explain") {
            const entry = diagnosticCatalog.get(args.code);
            result = entry ? { ok: true, ...entry } : failed("abi/unknown-code", `Unknown diagnostic code ${args.code}.`);
          } else if (params.name === "describe_nodes") {
            const identified = await abi.host.identifySyntax({ source: args.source });
            const described = await abi.host.describeNodes({ source: args.source, identity: identified.identity, ids: identified.identity.nodes.map(node => node.id) });
            result = { ok: !hasErrors(identified.diagnostics), ...described, diagnostics: identified.diagnostics };
          } else {
            const edited = await abi.host.applyEditScript({ source: args.source, script: args.script });
            result = edited.ok ? { ...edited, ...await checked({ source: edited.source }) } : { ...edited, diagnostics: edited.errors.map(error => ({ code: error.code, severity: "error", message: error.message })) };
          }
        }
      }
    } catch (error) {
      result = error instanceof ModuleError ? { ok: false, diagnostics: error.diagnostics } : failed("io/error", String(error));
    }
    if (params.name === "run") result = { value: null, printed: null, type: null, ...result };
    return {
      content: [{ type: "text" as const, text: `${params.name}: ${result.ok ? "ok" : "failed"}${typeof result.type === "string" ? ` (${result.type})` : ""}.` }],
      structuredContent: result,
      ...(result.ok === false ? { isError: true } : {}),
    };
  });
  await server.connect(new StdioServerTransport());
}
