import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serialize, deserialize } from "node:v8";
import { Env } from "../Env.js";
import { KFloat, KDictionary, KSymbol } from "../evaluator/types.js";
import { setPreludeSnapshotCache } from "../preludes/snapshot-cache.js";

declare const __FORMA_BUILD_ID__: string;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const prototypes = [Env.prototype,KFloat.prototype,KDictionary.prototype,Object.getPrototypeOf(KSymbol(""))];

/** Keep cyclic lexical closures and Map/Set identity, but never serialize code.
 * The cache is private, local, disposable build output, not an interchange format.
 */
function encode(value: unknown): Buffer {
  const seen = new Set<object>(), classes: [object,number][] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const index = prototypes.indexOf(Object.getPrototypeOf(value));
    if (index !== -1) classes.push([value,index]);
    if (value instanceof Map) for (const [key,item] of value) { visit(key); visit(item); }
    else if (value instanceof Set) for (const item of value) visit(item);
    else for (const item of Object.values(value)) visit(item);
  };
  visit(value);
  // V8 rejects JavaScript functions; closures here contain Lisp syntax + Env only.
  return serialize({value,classes});
}

function decode<T>(bytes: Uint8Array): T {
  const {value,classes} = deserialize(bytes) as {value:T;classes:[object,number][]};
  for (const [object,index] of classes) {
    if (!Number.isInteger(index) || !prototypes[index]) throw new Error("Invalid snapshot class");
    Object.setPrototypeOf(object,prototypes[index]);
  }
  return value;
}

/** Enable private persisted prelude snapshots for this process. No network.
 * Source runs without a build identity leave caching disabled. A cache miss,
 * unwritable directory or corrupt file never prevents normal compilation.
 */
export function enablePreludeCache(directory = process.env["FORMA_CACHE_DIR"] ?? join(process.env["XDG_CACHE_HOME"] ?? join(homedir(),".cache"),"forma","preludes")): void {
  if (process.env["FORMA_NO_CACHE"] === "1" || typeof __FORMA_BUILD_ID__ === "undefined") {
    setPreludeSnapshotCache(undefined);
    return;
  }
  const identity = JSON.stringify([__FORMA_BUILD_ID__,process.versions.node,process.versions.v8,process.env["FORMA_DISABLE_NATIVE_ELABORATION"] ?? ""]);
  const path = (key: string) => join(directory,hash(identity + key) + ".bin");
  setPreludeSnapshotCache({
    get<T>(key: string): T | undefined {
      try {
        const bytes = readFileSync(path(key));
        const checksum = bytes.subarray(0,64).toString();
        const payload = bytes.subarray(64);
        return checksum === hash(payload) ? decode<T>(payload) : undefined;
      } catch { return undefined; }
    },
    set(key: string, value: unknown): void {
      let temporary: string | undefined;
      try {
        const payload = encode(value);
        mkdirSync(directory,{recursive:true,mode:0o700});
        temporary = path(key) + "." + randomUUID();
        writeFileSync(temporary,Buffer.concat([Buffer.from(hash(payload)),payload]),{mode:0o600,flag:"wx"});
        renameSync(temporary,path(key));
      } catch { /* Caching is an optimization, including on read-only filesystems. */ }
      finally { if (temporary) { try { rmSync(temporary,{force:true}); } catch {} } }
    },
  });
}
