import expected from "../../../../conformance/fixtures/canonical-ir/expected.json";

type Declaration = Readonly<Record<string, unknown>> & { readonly kind: string };

const schemaKinds = new Set(["Entity", "Query"]);

/**
 * Declarations the OCaml engine emits for `entitySchemaSource`, taken from the
 * canonical IR conformance fixture. The fixture also loads `data.lisp`, so its
 * `Record` declarations are dropped here. Keys are reordered so `kind` and
 * `name` lead; values are unchanged.
 */
export function schemaDeclarations(): readonly Declaration[] {
  const artifact = expected.normalized.artifacts[0]!;
  return (artifact.content.declarations as readonly Declaration[])
    .filter((declaration) => schemaKinds.has(declaration.kind))
    .map(({ kind, name, ...rest }) => ({ kind, name, ...rest }));
}

export function schemaDeclarationsJson(): string {
  return `${JSON.stringify(schemaDeclarations(), null, 2)}\n`;
}

export const canonicalIrMediaType = expected.normalized.artifacts[0]!.mediaType;
