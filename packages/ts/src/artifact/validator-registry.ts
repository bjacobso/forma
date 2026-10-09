import type { Diagnostic } from "../diagnostic/diagnostic.js";
import type { PackageableDeclaration } from "./artifact.js";

export interface ValidatorInput {
  readonly declaration: PackageableDeclaration;
  readonly index: number;
}
export interface ArtifactValidator {
  readonly name: string;
  readonly kinds?: readonly string[];
  /** Batch validation permits references between declarations. */
  readonly validate: (inputs: readonly ValidatorInput[], all: readonly PackageableDeclaration[]) => readonly Diagnostic[];
}
export interface PayloadValidator {
  readonly kind: string;
  readonly validate: (input: ValidatorInput) => readonly Diagnostic[];
}

/** Host-owned registration. The packaging core has no domain-kind dispatch. */
export class ArtifactValidatorRegistry {
  readonly #validators = new Map<string, ArtifactValidator>();
  readonly #payloads = new Map<string, PayloadValidator>();

  register(validator: ArtifactValidator): this {
    if (this.#validators.has(validator.name)) throw new Error(`Duplicate artifact validator ${validator.name}`);
    this.#validators.set(validator.name, validator);
    return this;
  }
  registerPayload(validator: PayloadValidator): this {
    if (this.#payloads.has(validator.kind)) throw new Error(`Duplicate payload validator ${validator.kind}`);
    this.#payloads.set(validator.kind, validator);
    return this;
  }
  has(name: string): boolean { return this.#validators.has(name); }

  validate(declarations: readonly PackageableDeclaration[]): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const batches = new Map<string, ValidatorInput[]>();
    for (const [index, declaration] of declarations.entries()) {
      const input = { index, declaration };
      diagnostics.push(...(this.#payloads.get(declaration.summary.kind)?.validate(input) ?? []));
      const names = new Set([...(declaration.validators ?? []), ...[...this.#validators.values()].filter(v => v.kinds?.includes(declaration.summary.kind)).map(v => v.name)]);
      for (const name of names) {
        if (!this.has(name)) diagnostics.push(validatorDiagnostic(input, "artifact/unknown-validator", `Unknown artifact validator ${JSON.stringify(name)}.`));
        else {
          const batch = batches.get(name) ?? [];
          batch.push(input);
          batches.set(name, batch);
        }
      }
    }
    for (const [name, inputs] of batches) diagnostics.push(...this.#validators.get(name)!.validate(inputs, declarations));
    return diagnostics;
  }
}

export function validatorDiagnostic(input: ValidatorInput, code: string, message: string, path = "$"): Diagnostic {
  const pointer = path.replace(/^\$/, "").replace(/\.([^.[\]]+)|\[(\d+)\]/g, (_, field: string, index: string) => `/${(field ?? index).replaceAll("~", "~0").replaceAll("/", "~1")}`);
  const located = input.declaration.sourceMap?.filter(entry => pointer === entry.path || pointer.startsWith(`${entry.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  return {
    code, severity: "error", phase: "emit", message,
    ...(located?.span ?? input.declaration.span ? { span: located?.span ?? input.declaration.span } : {}),
    details: { index: input.index, path: `$.declarations[${input.index}].payload${path.slice(1)}` },
  };
}
