import type { PackageableDeclaration } from "./artifact/artifact.js";
/** Prelude-defined HttpApi declarations and a derived TypeScript builder DSL. */
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapHttpApiPreludes, linkHttpApiProgram } from "./artifact/http-api-link.js";
import { generateFormBuilders } from "./descriptor/form-builders.js";
import { emitFormTypeScript } from "./descriptor/form-emitter.js";
import { generateMechanicsEffectTypeScriptModule } from "./mechanics/effect-typescript.js";
import { isRecord } from "./mechanics/types.js";

export { bootstrapHttpApiPreludes };

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
  const link = linkHttpApiProgram(source, options.sourceId ?? "http-api.forma");
  if (!link.ok) return { ok: false, declarations: link.declarations, diagnostics: link.diagnostics };
  const { declarations, diagnostics } = link;
  const code = generateMechanicsEffectTypeScriptModule(link.mechanics.declarations, { check: link.mechanics.check! }).code;
  const chunks: string[] = [];
  const exports = new Set(
    [
      ...code.matchAll(
        /^export (?:const|class|type) ([A-Za-z_$][\w$]*)/gm,
      ),
    ].map((match) => match[1]!),
  );
  for (const d of link.domain) {
    if (!isRecord(d.payload)) continue;
    const exportName = link.exportName(d);
    if (exports.has(exportName)) {
      link.report(
        d,
        "name-collision",
        `Generated name ${exportName} is already in use.`,
      );
      continue;
    }
    exports.add(exportName);
    try {
      chunks.push(
        `export const ${exportName} = ${emitFormTypeScript(link.descriptor(d.formName!), d.payload, link.descriptors, link.schemaAnnotations)};`,
        "",
      );
    } catch (error) {
      link.report(d, "emit", String(error));
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
    code.trimEnd(),
    ...(imports.length
      ? [`import { ${imports.join(", ")} } from "effect/http-api";`]
      : []),
    ...(target.includes("Schema.") &&
    !/^import .*\bSchema\b.* from "effect";/m.test(code)
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
