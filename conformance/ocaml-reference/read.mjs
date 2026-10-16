// Keep the frozen OCaml compiler's fixture inputs in its legacy type dialect.
// The manifest pins exact source edits, not numeric values or output types.
import {readFileSync as readFile} from "node:fs";
import {createHash} from "node:crypto";
import {relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFile(new URL("numeric-vocabulary.json", import.meta.url), "utf8"));
const hash = text => createHash("sha256").update(text).digest("hex");

export function nativeReferenceEdits(file) {
  const name = relative(root, resolve(file instanceof URL ? fileURLToPath(file) : String(file)));
  return manifest.files[name]?.edits ?? [];
}

// Compare locations in the current authored source, rather than introducing
// offset-only differences from the reference's longer Number spelling.
export function remapNativeReferenceSpans(value, sourceId, edits) {
  const offset = position => {
    let delta = 0;
    for (const edit of edits) {
      const start = edit.start + delta;
      if (position <= start) return position - delta;
      if (position === start + edit.before.length) return edit.start + edit.after.length;
      if (position < start + edit.before.length) return edit.start + Math.min(position - start, edit.after.length);
      delta += edit.before.length - edit.after.length;
    }
    return position - delta;
  };
  const visit = node => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    if (node.sourceId === sourceId && Number.isInteger(node.startOffset) && Number.isInteger(node.endOffset)) {
      result.startOffset = offset(node.startOffset);
      result.endOffset = offset(node.endOffset);
    }
    return result;
  };
  return edits.length ? visit(value) : value;
}

export function readNativeReferenceFileSync(file, options) {
  const data = readFile(file, options);
  if (typeof file === "number") return data;
  const name = relative(root, resolve(file instanceof URL ? fileURLToPath(file) : String(file)));
  const entry = manifest.files[name];
  if (!entry) return data;
  let text = String(data);
  if (hash(text) !== entry.canonicalHash) throw new Error(`Stale native reference edits for ${name}; review the numeric vocabulary manifest.`);
  for (const edit of [...entry.edits].reverse()) {
    if (text.slice(edit.start, edit.start + edit.after.length) !== edit.after) throw new Error(`Invalid native reference edit in ${name}`);
    text = text.slice(0, edit.start) + edit.before + text.slice(edit.start + edit.after.length);
  }
  if (hash(text) !== entry.legacyHash) throw new Error(`Native reference source changed for ${name}`);
  return typeof data === "string" ? text : Buffer.from(text);
}
