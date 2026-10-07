import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { AnalysisWorkspace, type WorkspaceOptions } from "@formalang/ts/analysis";
import { TextDocument } from "vscode-languageserver-textdocument";

export interface FormaWorkspaceOptions {
  readonly workspaceRoot?: string;
  /** Prelude files, absolute or relative to the workspace root, in load order. */
  readonly preludePaths?: readonly string[];
  readonly analysis?: WorkspaceOptions;
}

/**
 * The editor's view of a Forma workspace: the open documents and the
 * configured preludes, analyzed by `@formalang/ts`. Sources are keyed by URI,
 * so locations in preludes are ordinary LSP locations.
 */
export class FormaWorkspace {
  readonly workspaceRoot: string;
  readonly analysis: AnalysisWorkspace;
  /** Open documents, including open preludes. */
  readonly documents = new Map<string, TextDocument>();

  readonly #preludeUris: readonly string[];
  readonly #preludePaths: ReadonlyMap<string, string>;
  #loading: Promise<void> | undefined;

  constructor(options: FormaWorkspaceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.analysis = new AnalysisWorkspace(options.analysis);
    const paths = (options.preludePaths ?? readPreludePathsFromEnv() ?? []).map((path) =>
      isAbsolute(path) ? path : resolve(this.workspaceRoot, path),
    );
    this.#preludePaths = new Map(paths.map((path) => [pathToFileURL(path).href, path]));
    this.#preludeUris = [...this.#preludePaths.keys()];
  }

  /** Load the configured preludes. Safe to call repeatedly. */
  async ready(): Promise<void> {
    this.#loading ??= (async () => {
      for (const uri of this.#preludeUris) {
        this.analysis.setPrelude(uri, await this.#readPrelude(uri));
      }
    })();
    await this.#loading;
  }

  isPrelude(uri: string): boolean {
    return this.#preludePaths.has(uri);
  }

  /**
   * Record a document's current text. Returns the open documents whose
   * analysis may have changed: just this one, or every open document when a
   * prelude changed.
   */
  async update(document: TextDocument): Promise<readonly TextDocument[]> {
    await this.ready();
    this.documents.set(document.uri, document);
    if (this.isPrelude(document.uri)) {
      this.analysis.setPrelude(document.uri, document.getText());
      return [...this.documents.values()];
    }
    this.analysis.setDocument(document.uri, document.getText());
    return [document];
  }

  /** Forget a closed document. A closed prelude reverts to its file. */
  async close(uri: string): Promise<readonly TextDocument[]> {
    this.documents.delete(uri);
    if (this.isPrelude(uri)) {
      this.analysis.setPrelude(uri, await this.#readPrelude(uri));
      return [...this.documents.values()];
    }
    this.analysis.removeDocument(uri);
    return [];
  }

  /** A document for converting offsets in any source, open or not. */
  document(uri: string): TextDocument | undefined {
    const open = this.documents.get(uri);
    if (open) return open;
    const text = this.analysis.text(uri);
    return text === undefined ? undefined : TextDocument.create(uri, "forma", 0, text);
  }

  async #readPrelude(uri: string): Promise<string> {
    const path = this.#preludePaths.get(uri)!;
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Cannot read prelude ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function readPreludePathsFromEnv(): readonly string[] | undefined {
  const raw = process.env["FORMA_LANGUAGE_SERVER_PRELUDES"];
  if (raw === undefined) return undefined;
  if (raw.trim() === "" || raw === "0" || raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}
