import { checkHttpApiDeclarations, type HttpDeclaration } from "./artifact/http-validator.js";
/** Prelude-defined HttpApi declarations and a derived TypeScript builder DSL. */
import type { JsonValue, PackageableDeclaration } from "./artifact/artifact.js";
import type { Diagnostic } from "./diagnostic/diagnostic.js";
import { bootstrapPreludes } from "./Preludes.js";
import {
  elaborateProgram,
  sourceLocator,
} from "./descriptor/elaborate.js";
import { generateFormBuilders } from "./descriptor/form-builders.js";
import {
  emitFormTypeScript,
} from "./descriptor/form-emitter.js";
import { generateEffectProgram } from "./mechanics/elaborate.js";
import {
  arrayItems,
  isRecord,
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
  const locate = sourceLocator(source, sourceId);
  const report = (
    d: HttpDeclaration,
    code: string,
    message: string,
    operation?: string,
  ): void => {
    const handle = parsed.find(
      (e) => head(e) === "handle" && e.loc.start === d.span?.startOffset,
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
  checkHttpApiDeclarations(projected.declarations, mechanics.declarations, report);
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
