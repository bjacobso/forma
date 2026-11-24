/** Messages between the reading editor and its analysis worker. Offsets are UTF-16 code units. */

/** A file the reader has open. Bundled preludes have ids such as `forma:cluster.lisp`. */
export interface SourceFile {
  readonly id: string;
  readonly source: string;
}

export const isPreludeFile = (id: string) => id.startsWith("forma:");

/**
 * The bundled preludes a reader loads, in order. Some stacks cannot share a
 * workspace, such as ontology's `entity` and Effect Cluster's, so each reader
 * picks one; `effect` is the default.
 */
export const PRELUDE_STACKS = {
  /** Only the kernel and compiler preludes, for a language defined in the reader's earlier code. */
  core: ["kernel.lisp", "compiler.lisp"],
  effect: ["kernel.lisp", "compiler.lisp", "rpc.lisp", "http-api.lisp", "cluster.lisp"],
  ontology: ["kernel.lisp", "compiler.lisp", "ontology.lisp"],
  ui: ["kernel.lisp", "compiler.lisp", "ontology.lisp", "ui.lisp"],
  email: ["kernel.lisp", "compiler.lisp", "email.lisp"],
  elm: ["kernel.lisp", "compiler.lisp", "elm.lisp"],
} as const;

export type PreludeStack = keyof typeof PRELUDE_STACKS;

export const isPreludeStack = (name: unknown): name is PreludeStack => typeof name === "string" && Object.hasOwn(PRELUDE_STACKS, name);

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
  /**
   * How the selection lowers: an Effect or prelude declaration to its IR record and
   * TypeScript, or a macro call one macro at a time.
   */
  readonly steps?: readonly ExpansionStep[] | undefined;
}

export interface ExpansionStep {
  readonly kind: "macro" | "ir" | "code";
  /** The macro that ran, or what the step shows. */
  readonly label: string;
  readonly text: string;
}

/** A top-level statement of the generated TypeScript. */
export interface GeneratedChunk {
  readonly from: number;
  readonly to: number;
  /** The name it declares, if any. */
  readonly name: string;
  /** Index into `Generated.declarations` of the source declaration it came from. */
  readonly declaration?: number | undefined;
}

export interface GeneratedDeclaration {
  readonly name: string;
  readonly kind: string;
  readonly from: number;
  readonly to: number;
  readonly payload: unknown;
  /** IR JSON pointers and the source each came from. */
  readonly sourceMap: readonly { readonly path: string; readonly from: number; readonly to: number }[];
}

export interface Generated {
  readonly ok: boolean;
  /** Why nothing was generated. */
  readonly message: string;
  readonly code: string;
  readonly chunks: readonly GeneratedChunk[];
  readonly declarations: readonly GeneratedDeclaration[];
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

/** One place a name occurs, with its line for a preview. */
export interface Occurrence {
  readonly file: string;
  readonly from: number;
  readonly to: number;
  /** The definition, an `import`/`export` list entry, or a use. */
  readonly role: "definition" | "module" | "use";
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface References {
  readonly name: string;
  /** A name defined in the files or preludes, a prelude form head, a builtin, or neither. */
  readonly kind: "definition" | "form" | "builtin" | "none";
  readonly occurrences: readonly Occurrence[];
  readonly renamable: boolean;
  readonly definedIn?: string | undefined;
}

export type RenameEdits =
  | { readonly ok: true; readonly name: string; readonly edits: Readonly<Record<string, readonly { readonly from: number; readonly to: number; readonly insert: string }[]>> }
  | { readonly ok: false; readonly message: string };

/** A top-level definition of an open file. */
export interface FileSymbol {
  readonly file: string;
  readonly name: string;
  readonly kind: string;
  /** The head of the form that defines it, such as `define` or `entity`. */
  readonly form: string;
  readonly from: number;
  readonly to: number;
  readonly formFrom: number;
  readonly formTo: number;
  readonly type?: string | undefined;
  /** Uses in the open files, not counting the definition and import/export lists. */
  readonly uses: number;
}

/** What a reader checks against besides its files; fixed for the reader's life. */
export interface ReaderSetup {
  readonly preludes: PreludeStack;
  /**
   * Code in scope for every file without an import, and read-only, such as the
   * earlier blocks of a docs page. It opens as `forma:earlier.lisp`.
   */
  readonly before?: string | undefined;
  /**
   * Open files in scope for every other open file without an import, such as a
   * playground's language definition for its program. Editable, unlike `before`.
   */
  readonly implicit?: readonly string[] | undefined;
}

export const EARLIER_FILE = "forma:earlier.lisp";

/** `scope` names the reader, so readers sharing a worker keep their own workspaces. */
interface Base { readonly id: number; readonly scope: string; readonly setup: ReaderSetup; readonly files: readonly SourceFile[]; readonly file: string }

export type ReadingRequest =
  | (Base & { readonly kind: "analyze" })
  | (Base & { readonly kind: "inspect"; readonly from: number; readonly to: number })
  | (Base & { readonly kind: "definition"; readonly offset: number })
  | (Base & { readonly kind: "complete"; readonly offset: number })
  | (Base & { readonly kind: "problems" })
  | (Base & { readonly kind: "snippets" })
  | (Base & { readonly kind: "references"; readonly offset: number })
  | (Base & { readonly kind: "rename"; readonly offset: number; readonly name: string })
  | (Base & { readonly kind: "symbols" })
  | (Base & { readonly kind: "generated" })
  | (Base & { readonly kind: "prelude" })
  | (Base & { readonly kind: "dispose" });

export type ReadingResponse =
  | { readonly id: number; readonly kind: "analyze"; readonly analysis: Analysis }
  | { readonly id: number; readonly kind: "inspect"; readonly inspection: Inspection }
  | { readonly id: number; readonly kind: "definition"; readonly location: Location | null }
  | { readonly id: number; readonly kind: "complete"; readonly completions: Completions | null }
  | { readonly id: number; readonly kind: "problems"; readonly problems: Problems }
  | { readonly id: number; readonly kind: "snippets"; readonly snippets: readonly SnippetEntry[] }
  | { readonly id: number; readonly kind: "references"; readonly references: References }
  | { readonly id: number; readonly kind: "rename"; readonly rename: RenameEdits }
  | { readonly id: number; readonly kind: "symbols"; readonly symbols: readonly FileSymbol[] }
  | { readonly id: number; readonly kind: "generated"; readonly generated: Generated }
  | { readonly id: number; readonly kind: "prelude"; readonly source: string }
  | { readonly id: number; readonly kind: "dispose" }
  | { readonly id: number; readonly kind: "error"; readonly message: string };
