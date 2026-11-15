import { isPreludeFile, isPreludeStack, type PreludeStack } from "../reading/protocol";

/** A custom-language playground: a prelude and a program written in it. */
export interface PreludeDemo {
  readonly title: string;
  readonly prelude: string;
  readonly source: string;
}

/** A reader tab. Bundled preludes (`forma:` ids) are kept by name; their text comes from the site. */
export interface SharedFile {
  readonly id: string;
  readonly source?: string;
}

/** The reading editor's open files, in tab order, the file it shows, and the preludes it checks against. */
export interface ReaderSnapshot {
  readonly kind: "reader";
  readonly preludes: PreludeStack;
  readonly files: readonly SharedFile[];
  readonly active: string;
}

/** The playground workbench's example and its edited source. */
export interface WorkbenchSnapshot {
  readonly kind: "workbench";
  readonly example: string;
  readonly source: string;
}

export type PlaygroundSnapshot = ({ readonly kind: "custom" } & PreludeDemo) | ReaderSnapshot | WorkbenchSnapshot;

export const MAX_SNAPSHOT_BYTES = 128 * 1024;
export const snapshotIdPattern = /^[a-f0-9]{32}$/;
const MAX_READER_FILES = 64;
const examplePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Reads a stored or submitted snapshot. Custom playgrounds have no `kind`, as they did before readers could be shared. */
export function readSnapshot(value: unknown): PlaygroundSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1) return null;
  if (snapshot.kind === undefined) {
    if (typeof snapshot.title !== "string" || !snapshot.title.trim() || snapshot.title.length > 160 || typeof snapshot.prelude !== "string" || typeof snapshot.source !== "string") return null;
    return { kind: "custom", title: snapshot.title, prelude: snapshot.prelude, source: snapshot.source };
  }
  if (snapshot.kind === "workbench") {
    if (typeof snapshot.example !== "string" || !examplePattern.test(snapshot.example) || typeof snapshot.source !== "string") return null;
    return { kind: "workbench", example: snapshot.example, source: snapshot.source };
  }
  if (snapshot.kind !== "reader" || !isPreludeStack(snapshot.preludes) || typeof snapshot.active !== "string" || !Array.isArray(snapshot.files)) return null;
  if (!snapshot.files.length || snapshot.files.length > MAX_READER_FILES) return null;
  const files: SharedFile[] = [];
  for (const item of snapshot.files as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const { id, source } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 200 || files.some(file => file.id === id)) return null;
    // A bundled prelude is named, never stored; every other file carries its text.
    if (isPreludeFile(id) ? source !== undefined : typeof source !== "string") return null;
    files.push(isPreludeFile(id) ? { id } : { id, source: source as string });
  }
  if (!files.some(file => !isPreludeFile(file.id)) || !files.some(file => file.id === snapshot.active)) return null;
  return { kind: "reader", preludes: snapshot.preludes, files, active: snapshot.active };
}

/** The stored JSON, which the snapshot's ID hashes. Custom playgrounds keep their original shape, so their IDs are unchanged. */
export function snapshotJson(snapshot: PlaygroundSnapshot): string {
  if (snapshot.kind === "custom") return JSON.stringify({ version: 1, title: snapshot.title, prelude: snapshot.prelude, source: snapshot.source });
  if (snapshot.kind === "workbench") return JSON.stringify({ version: 1, kind: snapshot.kind, example: snapshot.example, source: snapshot.source });
  return JSON.stringify({ version: 1, kind: snapshot.kind, preludes: snapshot.preludes, files: snapshot.files.map(file => (file.source === undefined ? { id: file.id } : { id: file.id, source: file.source })), active: snapshot.active });
}

/** Where a snapshot opens. */
export function snapshotPath(id: string, snapshot: PlaygroundSnapshot): string {
  if (snapshot.kind === "reader") return `/playground/read?snapshot=${id}`;
  if (snapshot.kind === "workbench") return `/playground/live/${snapshot.example}?snapshot=${id}`;
  return `/playground/p/${id}`;
}
