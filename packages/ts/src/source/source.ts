import { sha256 } from "./sha256.js";

export type SourceOrigin =
  | { readonly kind: "direct" }
  | {
      readonly kind: "markdown-fence";
      readonly fileId: string;
      readonly blockIndex: number;
      readonly blockStartOffset: number;
      readonly blockStartLine: number;
      readonly blockStartColumn: number;
    };

export interface Source {
  readonly id: string;
  readonly text: string;
  readonly origin?: SourceOrigin | undefined;
  readonly hash: string;
}

export interface SourceInput {
  readonly id: string;
  readonly text: string;
  readonly origin?: SourceOrigin | undefined;
}

export function makeSource(input: SourceInput): Source {
  let hash: string | undefined;
  return {
    id: input.id,
    text: input.text,
    ...(input.origin ? { origin: input.origin } : {}),
    // Computed on first use; most editor sources are never asked for it.
    get hash() {
      return (hash ??= hashSourceText(input.text));
    },
  };
}

/** Lowercase hex SHA-256 of the UTF-8 source text. */
export function hashSourceText(text: string): string {
  return sha256(text);
}
