/** Prelude-defined HttpApi declarations and a derived TypeScript builder DSL. */
import type { JsonValue, PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import {
  elaborateProgram,
  sourceLocator,
  type ElaboratedDeclaration,
} from "./descriptor/elaborate.js";
import { generateFormBuilders } from "./descriptor/form-builders.js";
import {
  emitFormTypeScript,
  emissionDatum,
  emissionSchema,
} from "./descriptor/form-emitter.js";
import { generateEffectProgram } from "./mechanics/elaborate.js";
import { checkMechanicsDeclarations } from "./mechanics/check.js";
import {
  arrayItems,
  isRecord,
  isAssignable,
  typeFromJson,
  type MField,
  type MType,
} from "./mechanics/types.js";
import { typeName } from "./mechanics/naming.js";
import { parse, toSExprMany } from "./reader/index.js";
import { head, name } from "./surface/effect.js";

export const bootstrapHttpApiPreludes = () =>
  bootstrapPreludes(["compiler.lisp", "http-api.lisp"]);

export interface HttpApiProgramResult {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly code?: string;
}

/** Produce standalone Effect code, with located endpoint/operation checks. */
export function generateHttpApiProgram(
  source: string,
  options: { readonly sourceId?: string } = {},
): HttpApiProgramResult {
  const sourceId = options.sourceId ?? "http-api.forma";
  const prelude = bootstrapHttpApiPreludes();
  let projected: ReturnType<typeof elaborateProgram>;
  try {
    projected = elaborateProgram(source, { prelude, sourceId });
  } catch (error) {
    return {
      ok: false,
      declarations: [],
      diagnostics: [
        {
          code: "http-api/parse",
          severity: "error",
          phase: "parse",
          message: String(error),
        },
      ],
    };
  }
  const parsed = toSExprMany(parse(source).redTree);
  // Hide domain declarations from the operational checker without moving its
  // authored offsets. The descriptor pipeline has already checked these forms.
  let mechanicsSource = source;
  for (const e of [...parsed].reverse())
    if (prelude.descriptions.get(head(e) ?? "")?.surface) {
      mechanicsSource =
        mechanicsSource.slice(0, e.loc.start) +
        mechanicsSource.slice(e.loc.start, e.loc.end).replace(/[^\r\n]/g, " ") +
        mechanicsSource.slice(e.loc.end);
    }
  const mechanics = generateEffectProgram(mechanicsSource, { sourceId });
  const diagnostics: Diagnostic[] = [
    ...projected.diagnostics,
    ...mechanics.diagnostics.map((d) => ({
      ...d,
      phase: "typecheck" as const,
    })),
  ];
  const declarations = [...mechanics.declarations, ...projected.declarations];
  const info = checkMechanicsDeclarations(mechanics.declarations).info;
  const type = (value: JsonValue): MType =>
    typeFromJson(emissionSchema(emissionDatum(value)), info.env);
  const locate = sourceLocator(source, sourceId);
  const report = (
    d: ElaboratedDeclaration,
    code: string,
    message: string,
    operation?: string,
  ): void => {
    const handle = parsed.find(
      (e) => head(e) === "handle" && e.loc.start === d.span.startOffset,
    );
    const child =
      operation && handle?._tag === "List"
        ? handle.items.find(
            (e) =>
              head(e) === "handler" &&
              e._tag === "List" &&
              name(e.items[2]) === operation,
          )
        : undefined;
    diagnostics.push({
      code: `http-api/${code}`,
      severity: "error",
      phase: "typecheck",
      message,
      span: child ? locate(child.loc) : d.span,
    });
  };
  const apis = projected.declarations.filter((d) => d.formName === "api");
  const groupHandlers = new Set<string>();
  for (const declaration of projected.declarations) {
    const payload = declaration.payload;
    if (!isRecord(payload)) continue;
    if (declaration.formName === "api") {
      const groups = new Set<string>();
      for (const group of arrayItems(payload["groups"]).filter(isRecord)) {
        const groupName = String(group["name"]);
        if (groups.has(groupName))
          report(
            declaration,
            "duplicate-group",
            `Duplicate group ${groupName}.`,
          );
        groups.add(groupName);
        const endpoints = new Set<string>();
        for (const endpoint of arrayItems(group["endpoints"]).filter(
          isRecord,
        )) {
          const endpointName = String(endpoint["name"]);
          if (endpoints.has(endpointName))
            report(
              declaration,
              "duplicate-endpoint",
              `Duplicate endpoint ${groupName}.${endpointName}.`,
            );
          endpoints.add(endpointName);
          for (const error of arrayItems(endpoint["errors"]))
            if (typeof error !== "string" || !info.env.errors.has(error))
              report(
                declaration,
                "error-schema",
                `Endpoint ${endpointName} refers to undeclared error ${String(error)}.`,
              );
          if (
            ["get", "delete"].includes(String(endpoint["method"])) &&
            endpoint["payload"] !== undefined
          )
            report(
              declaration,
              "payload-method",
              `Endpoint ${endpointName}: payload schemas require a body method (post, put, or patch).`,
            );
          if (
            typeof endpoint["path"] !== "string" ||
            !endpoint["path"].startsWith("/")
          )
            report(
              declaration,
              "path",
              `Endpoint ${endpointName} needs an absolute HTTP path.`,
            );
        }
      }
    }
    if (declaration.formName !== "handle") continue;
    const key = `${String(payload["api"])}.${String(payload["group"])}`;
    if (groupHandlers.has(key))
      report(
        declaration,
        "duplicate-handle",
        `Group ${key} already has a handle declaration.`,
      );
    groupHandlers.add(key);
    const api = apis.find(
      (d) => isRecord(d.payload) && d.payload["name"] === payload["api"],
    );
    const group = isRecord(api?.payload)
      ? arrayItems(api.payload["groups"])
          .filter(isRecord)
          .find((g) => g["name"] === payload["group"])
      : undefined;
    if (!group) {
      report(declaration, "unknown-group", `Unknown HTTP group ${key}.`);
      continue;
    }
    const handled = new Set<string>();
    for (const handler of arrayItems(payload["handlers"]).filter(isRecord)) {
      const endpointName = String(handler["endpoint"]),
        operation = String(handler["operation"]);
      if (handled.has(endpointName))
        report(
          declaration,
          "duplicate-handler",
          `Endpoint ${key}.${endpointName} is handled twice.`,
          operation,
        );
      handled.add(endpointName);
      const endpoint = arrayItems(group["endpoints"])
        .filter(isRecord)
        .find((e) => e["name"] === endpointName);
      const signature = info.operations.get(operation);
      if (!endpoint) {
        report(
          declaration,
          "unknown-endpoint",
          `Unknown endpoint ${key}.${endpointName}.`,
          operation,
        );
        continue;
      }
      if (!signature) {
        report(
          declaration,
          "unknown-operation",
          `Unknown Effect operation ${operation}.`,
          operation,
        );
        continue;
      }
      const allowed = new Set(arrayItems(endpoint["errors"]).map(String));
      for (const error of signature.result.errors.keys())
        if (!allowed.has(error))
          report(
            declaration,
            "undeclared-error",
            `Handler ${operation} can fail with ${error}, but endpoint ${endpointName} does not declare it.`,
            operation,
          );
      if (
        endpoint["success"] !== undefined &&
        !isAssignable(
          signature.result.success,
          type(endpoint["success"]),
          info.env,
        )
      )
        report(
          declaration,
          "handler-success",
          `Handler ${operation} does not return the success type of endpoint ${endpointName}.`,
          operation,
        );
      const fields: MField[] = [];
      for (const field of ["params", "payload"] as const)
        if (endpoint[field] !== undefined)
          fields.push({
            name: field,
            type: type(endpoint[field]),
            optional: false,
          });
      const request: MType = { kind: "struct", fields };
      if (
        signature.params.length !== 1 ||
        !isAssignable(request, signature.params[0]!.type, info.env)
      )
        report(
          declaration,
          "handler-request",
          `Handler ${operation} must accept one request matching endpoint ${endpointName}.`,
          operation,
        );
    }
    for (const endpoint of arrayItems(group["endpoints"]).filter(isRecord))
      if (!handled.has(String(endpoint["name"])))
        report(
          declaration,
          "missing-handler",
          `Endpoint ${key}.${String(endpoint["name"])} has no handler.`,
        );
  }
  if (diagnostics.some((d) => d.severity === "error"))
    return { ok: false, declarations, diagnostics };
  const descriptors = prelude.descriptions.list();
  const schemaAnnotations = new Map(
    mechanics.declarations.flatMap((d) =>
      isRecord(d.payload) &&
      d.payload["kind"] === "ErrorDef" &&
      typeof d.payload["status"] === "number"
        ? [
            [
              String(d.payload["name"]),
              { httpApiStatus: d.payload["status"] },
            ] as const,
          ]
        : [],
    ),
  );
  const chunks: string[] = [];
  const exports = new Set(
    [
      ...mechanics.code!.matchAll(
        /^export (?:const|class|type) ([A-Za-z_$][\w$]*)/gm,
      ),
    ].map((match) => match[1]!),
  );
  for (const d of projected.declarations) {
    if (!isRecord(d.payload)) continue;
    const exportName =
      d.formName === "handle"
        ? `${typeName(String(d.payload["api"]))}${typeName(String(d.payload["group"]))}Live`
        : typeName(String(d.payload["name"]));
    if (exports.has(exportName)) {
      report(
        d,
        "name-collision",
        `Generated name ${exportName} is already in use.`,
      );
      continue;
    }
    exports.add(exportName);
    try {
      chunks.push(
        `export const ${exportName} = ${emitFormTypeScript(prelude.descriptions.get(d.formName)!, d.payload, descriptors, schemaAnnotations)};`,
        "",
      );
    } catch (error) {
      report(d, "emit", String(error));
    }
  }
  const target = chunks.join("\n");
  const imports = [
    "HttpApi",
    "HttpApiBuilder",
    "HttpApiEndpoint",
    "HttpApiGroup",
  ].filter((n) => target.includes(`${n}.`));
  const statements = [
    mechanics.code!.trimEnd(),
    ...(imports.length
      ? [`import { ${imports.join(", ")} } from "effect/unstable/httpapi";`]
      : []),
    ...(target.includes("Schema.") &&
    !/^import .*\bSchema\b.* from "effect";/m.test(mechanics.code!)
      ? ['import { Schema } from "effect";']
      : []),
    "",
    target,
  ];
  return diagnostics.some((d) => d.severity === "error")
    ? { ok: false, declarations, diagnostics }
    : {
        ok: true,
        declarations,
        diagnostics,
        code: statements.filter((s, i) => s !== "" || i > 0).join("\n"),
      };
}

/** No HTTP factory templates live here: expressions come from the Lisp hooks. */
export function generateHttpApiBuilders(): { readonly code: string } {
  return generateFormBuilders({
    descriptors: bootstrapHttpApiPreludes().descriptions.list(),
    forms: ["endpoint", "group", "api"],
    imports: [
      'import { Schema } from "effect";',
      'import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiSchema } from "effect/unstable/httpapi";',
      'import type { HttpRouter } from "effect/unstable/http";',
      "type ErrorSchema<S> = S extends HttpApiSchema.WithHeaders<infer Inner, Schema.Top> ? Inner : S;",
      "type ErrorSchemas<S extends readonly Schema.Top[]> = [Extract<ErrorSchema<S[number]>, HttpApiSchema.StreamSchema>] extends [never] ? S : never;",
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
