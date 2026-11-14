/** Messages between the reading editor and its analysis worker. Offsets are UTF-16 code units. */

export interface TypedForm {
  readonly from: number;
  readonly to: number;
  /** The checker's own display string. */
  readonly type: string;
  /** Which checker node typed the form, such as `App` or `Mechanics.ServiceCall`. */
  readonly tag: string;
}

export interface ReadingDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
  readonly help?: string | undefined;
  readonly candidates?: readonly string[] | undefined;
  readonly expected?: string | undefined;
  readonly fix?: readonly { readonly from: number; readonly to: number; readonly insert: string }[] | undefined;
}

export interface Analysis {
  readonly source: string;
  readonly typed: readonly TypedForm[];
  readonly diagnostics: readonly ReadingDiagnostic[];
  readonly durationMs: number;
}

export interface SlotInfo {
  readonly name: string;
  readonly type?: string | undefined;
  readonly doc?: string | undefined;
  readonly required: boolean;
  readonly many: boolean;
  readonly missing: boolean;
  readonly filled: boolean;
  /** The values written for the slot, in the document. */
  readonly values: readonly { readonly from: number; readonly to: number; readonly text: string }[];
}

export interface FormInfo {
  readonly name: string;
  /** The bundled prelude that declares the form, such as `rpc.lisp`. */
  readonly prelude?: string | undefined;
  readonly from: number;
  readonly to: number;
  readonly doc?: string | undefined;
  readonly produces?: string | undefined;
  /** Positional identifiers, such as the name a form declares. */
  readonly identifiers: readonly { readonly name: string; readonly value?: string | undefined }[];
  readonly slots: readonly SlotInfo[];
  readonly activeSlot?: string | undefined;
}

export interface DefinitionInfo {
  readonly name: string;
  readonly kind: string;
  readonly form: string;
  readonly local: boolean;
  /** Where the name is defined, when in this document. */
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  readonly elsewhere?: string | undefined;
  readonly references: number;
  readonly type?: string | undefined;
}

export interface Inspection {
  /** The innermost descriptor form around the selection, from the preludes. */
  readonly form?: FormInfo | undefined;
  /** The name at the start of the selection. */
  readonly definition?: DefinitionInfo | undefined;
  /** The selected form after kernel macros, when a macro rewrote it. */
  readonly expansion?: string | undefined;
}

export type ReadingRequest =
  | { readonly id: number; readonly kind: "analyze"; readonly source: string }
  | { readonly id: number; readonly kind: "inspect"; readonly source: string; readonly from: number; readonly to: number };

export type ReadingResponse =
  | { readonly id: number; readonly kind: "analyze"; readonly analysis: Analysis }
  | { readonly id: number; readonly kind: "inspect"; readonly inspection: Inspection }
  | { readonly id: number; readonly kind: "error"; readonly message: string };
