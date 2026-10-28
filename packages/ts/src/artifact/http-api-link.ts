/**
 * The host-neutral half of the http-api linker: elaborate the prelude forms,
 * check the Effect program they reference, and check each handler against
 * its endpoint. Host backends (Effect TypeScript, effect-go) emit from the
 * result.
 */
import type { PackageableDeclaration, JsonValue } from "./artifact.js";
import { checkHttpApiDeclarations, type HttpDeclaration } from "./http-validator.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { bootstrapPreludes } from "../Preludes.js";
import { elaborateProgram, sourceLocator } from "../descriptor/elaborate.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { elaborateEffectProgram, type EffectProgramElaboration } from "../mechanics/elaborate.js";
import { isRecord } from "../mechanics/types.js";
import { typeName } from "../mechanics/naming.js";
import { parse, toSExprMany } from "../reader/index.js";
import { head, name } from "../surface/effect.js";

export const bootstrapHttpApiPreludes = () =>
  bootstrapPreludes(["compiler.lisp", "http-api.lisp"]);

export type HttpApiLink =
  | { readonly ok: false; readonly declarations: readonly PackageableDeclaration[]; readonly diagnostics: readonly Diagnostic[] }
  | {
      readonly ok: true;
      readonly declarations: readonly PackageableDeclaration[];
      readonly diagnostics: Diagnostic[];
      /** The checked Effect program, without the domain forms. */
      readonly mechanics: EffectProgramElaboration;
      /** Projected domain declarations, in source order. */
      readonly domain: readonly HttpDeclaration[];
      readonly descriptors: readonly FormDescriptor[];
      readonly descriptor: (formName: string) => FormDescriptor;
      /** Schema annotations by declaration name, such as an error's HTTP status. */
      readonly schemaAnnotations: ReadonlyMap<string, Readonly<Record<string, JsonValue>>>;
      /** The exported name a domain declaration gets on every host. */
      readonly exportName: (declaration: HttpDeclaration) => string;
      /** Reports a diagnostic located on a domain form (or one of its handlers). */
      readonly report: (declaration: HttpDeclaration, code: string, message: string, operation?: string) => void;
    };

export function linkHttpApiProgram(source: string, sourceId: string): HttpApiLink {
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
  const mechanics = elaborateEffectProgram(mechanicsSource, { sourceId });
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
  return {
    ok: true,
    declarations,
    diagnostics,
    mechanics,
    domain: projected.declarations,
    descriptors: prelude.descriptions.list(),
    descriptor: (formName) => prelude.descriptions.get(formName)!,
    schemaAnnotations,
    exportName: (d) =>
      isRecord(d.payload) && d.formName === "handle"
        ? `${typeName(String(d.payload["api"]))}${typeName(String(d.payload["group"]))}Live`
        : typeName(String(isRecord(d.payload) ? d.payload["name"] : "")),
    report,
  };
}
