/** Messages between the reading editor and its analysis worker. Offsets are UTF-16 code units. */

/** A file the reader has open. Bundled preludes have ids such as `forma:cluster.lisp`. */
export interface SourceFile {
  readonly id: string;
  readonly source: string;
}

export const isPreludeFile = (id: string) => id.startsWith("forma:");

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
  readonly file: string;
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
  /** The form's surface pattern, such as `(entity name {:keys [state …]} message ...)`. */
  readonly pattern?: string | undefined;
  /** The first checked example from the prelude. */
  readonly example?: string | undefined;
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
  /** Where the name occurs in the inspected file, for go to definition. */
  readonly at: number;
  /** This occurrence is the definition itself. */
  readonly here: boolean;
  /** The file that defines it, when it is not the inspected file. */
  readonly file?: string | undefined;
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

/** Where go to definition lands: the name, and the form that defines it. */
export interface Location {
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly formFrom: number;
  readonly formTo: number;
  /** The text of a bundled prelude, so the reader can open it. */
  readonly source?: string | undefined;
}

export interface CompletionEntry {
  readonly label: string;
  readonly kind: string;
  readonly detail?: string | undefined;
  readonly info?: string | undefined;
  /** A CodeMirror snippet template with `${field}` placeholders. */
  readonly template?: string | undefined;
  readonly boost?: number | undefined;
}

export interface Completions {
  readonly from: number;
  readonly entries: readonly CompletionEntry[];
}

export interface SnippetEntry {
  readonly label: string;
  /** The bundled prelude that declares the form, or `kernel`. */
  readonly group: string;
  /** A CodeMirror snippet template without the outer parentheses. */
  readonly template: string;
  readonly doc?: string | undefined;
}

export type Problems = Readonly<Record<string, { readonly errors: number; readonly warnings: number }>>;

interface Base { readonly id: number; readonly files: readonly SourceFile[]; readonly file: string }

export type ReadingRequest =
  | (Base & { readonly kind: "analyze" })
  | (Base & { readonly kind: "inspect"; readonly from: number; readonly to: number })
  | (Base & { readonly kind: "definition"; readonly offset: number })
  | (Base & { readonly kind: "complete"; readonly offset: number })
  | (Base & { readonly kind: "problems" })
  | (Base & { readonly kind: "snippets" });

export type ReadingResponse =
  | { readonly id: number; readonly kind: "analyze"; readonly analysis: Analysis }
  | { readonly id: number; readonly kind: "inspect"; readonly inspection: Inspection }
  | { readonly id: number; readonly kind: "definition"; readonly location: Location | null }
  | { readonly id: number; readonly kind: "complete"; readonly completions: Completions | null }
  | { readonly id: number; readonly kind: "problems"; readonly problems: Problems }
  | { readonly id: number; readonly kind: "snippets"; readonly snippets: readonly SnippetEntry[] }
  | { readonly id: number; readonly kind: "error"; readonly message: string };
