/** Prelude-defined HttpApi declarations and a derived TypeScript builder DSL. */
import { checkHttpApiDeclarations, type HttpDeclaration } from "./artifact/http-validator.js";
import type { PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import { generateFormBuilders } from "./descriptor/form-builders.js";
import { emitFormTypeScript } from "./descriptor/form-emitter.js";
import { linkEffectSystem, type EffectExtension } from "./effect-system/link.js";
import { arrayItems, isRecord } from "./mechanics/types.js";
import { typeName } from "./mechanics/naming.js";
import { head, name } from "./surface/effect.js";

export const bootstrapHttpApiPreludes = () =>
  bootstrapPreludes(["compiler.lisp", "http-api.lisp"]);

export interface HttpApiProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

const items = (payload: unknown, key: string) =>
  arrayItems(isRecord(payload) ? payload[key] : undefined).filter(isRecord);

/** APIs, groups, and handler registrations emit native Effect HttpApi code.
 * Handlers reuse ordinary operations, checked against each endpoint.
 */
export const httpApiExtension: EffectExtension = {
  namespace: "http-api",
  prelude: "http-api.lisp",
  forms: ["api", "group", "endpoint", "handle", "handler"],
  imports: { "effect/http-api": ["HttpApi", "HttpApiBuilder", "HttpApiEndpoint", "HttpApiGroup"] },
  check: ({ declarations, importedDeclarations, mechanics, authored, locate, report }) => {
    checkHttpApiDeclarations([...importedDeclarations.filter(d => d.formName === "api"), ...declarations], mechanics, (d: HttpDeclaration, code, message, operation) => {
      // Point at the handler that links the operation, when there is one.
      const handle = authored.find((e) => head(e) === "handle" && e.loc.start === d.span?.startOffset);
      const child = operation && handle?._tag === "List"
        ? handle.items.find((e) => head(e) === "handler" && e._tag === "List" && name(e.items[2]) === operation)
        : undefined;
      report(child ? locate(child) : d.span, code, message);
    });
  },
  emit: (d, { prelude, mechanics }) => {
    if (!isRecord(d.payload)) return [];
    const schemaAnnotations = new Map(
      mechanics.flatMap((m) =>
        isRecord(m.payload) && m.payload["kind"] === "ErrorDef" && typeof m.payload["status"] === "number"
          ? [[String(m.payload["name"]), { httpApiStatus: m.payload["status"] }] as const]
          : [],
      ),
    );
    return [{
      name: d.formName === "handle"
        ? `${typeName(String(d.payload["api"]))}${typeName(String(d.payload["group"]))}Live`
        : typeName(String(d.payload["name"])),
      code: emitFormTypeScript(prelude.descriptions.get(d.formName)!, d.payload, prelude.descriptions.list(), schemaAnnotations),
    }];
  },
  graph: (d, _context, add) => {
    if (!isRecord(d.payload)) return;
    if (d.formName === "api") {
      const api = String(d.payload["name"]);
      const id = add.node("http-api", api, d.span);
      for (const group of items(d.payload, "groups")) {
        const groupName = `${api}/${String(group["name"])}`;
        const groupId = add.node("http-group", groupName);
        add.edge(id, groupId, "contains");
        for (const endpoint of items(group, "endpoints")) {
          const endpointId = add.node("endpoint", `${groupName}/${String(endpoint["name"])}`, undefined, {
            method: String(endpoint["method"]), path: String(endpoint["path"]),
          });
          add.edge(groupId, endpointId, "contains");
          for (const key of ["params", "payload", "success"]) add.uses(endpointId, endpoint[key]);
          for (const error of arrayItems(endpoint["errors"])) add.uses(endpointId, error, "raises");
        }
      }
    } else if (d.formName === "handle") {
      const group = `${String(d.payload["api"])}/${String(d.payload["group"])}`;
      for (const handler of items(d.payload, "handlers"))
        add.edge(`endpoint:${group}/${String(handler["endpoint"])}`, `operation:${String(handler["operation"])}`, "handled-by");
    }
  },
};

/** Produce standalone Effect code, with located endpoint/operation checks. */
export function generateHttpApiProgram(
  source: string,
  options: { readonly sourceId?: string } = {},
): HttpApiProgramResult {
  const { system: _, ...result } = linkEffectSystem(source, [httpApiExtension], {
    sourceId: options.sourceId ?? "http-api.lisp", namespace: "http-api",
  });
  return result;
}

/** No HTTP factory templates live here: expressions come from the Lisp hooks. */
export function generateHttpApiBuilders(): { readonly code: string } {
  return generateFormBuilders({
    descriptors: bootstrapHttpApiPreludes().descriptions.list(),
    forms: ["endpoint", "group", "api"],
    imports: [
      'import { Schema } from "effect";',
      'import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiSchema } from "effect/http-api";',
      'import type { HttpRouter } from "effect/http";',
      "type ErrorSchema<S> = S extends HttpApiSchema.WithHeaders<infer Inner, Schema.Top> ? Inner : S;",
      "type ErrorSchemas<S extends HttpApiEndpoint.ErrorConstraint> = [Extract<ErrorSchema<S extends ReadonlyArray<Schema.Constraint> ? S[number] : S>, HttpApiSchema.StreamSchema | HttpApiSchema.Upgrade>] extends [never] ? S : never;",
    ],
    typeOverrides: Object.fromEntries(
      ["get", "post", "put", "patch", "delete"].flatMap((method) => [
        [`endpoint.${method}.path`, "HttpRouter.PathInput"],
        ...(["get", "delete"].includes(method)
          ? [[`endpoint.${method}.payload`, "never"]]
          : []),
      ]),
    ),
    inputTypeOverrides: Object.fromEntries(
      ["get", "post", "put", "patch", "delete"].map((method) => [
        `endpoint.${method}.errors`,
        "Errors & ErrorSchemas<NoInfer<Errors>>",
      ]),
    ),
    typeArguments: Object.fromEntries(
      ["get", "post", "put", "patch", "delete"].map((method) => [
        `endpoint.${method}`,
        [
          "Name",
          "Path",
          "Params",
          "never",
          "Payload",
          "never",
          "Success",
          "Errors",
        ],
      ]),
    ),
    childValueTypes: {
      group: "HttpApiEndpoint.Constraint",
      api: "HttpApiGroup.Constraint",
    },
    parentValueTypes: {
      group: 'HttpApiGroup.HttpApiGroup<Name, Children[number]["value"]>',
      api: 'HttpApi.HttpApi<Name, Children[number]["value"]>',
    },
  });
}
