/** @experimental Output paths for linked Effect modules. */
export interface EffectModuleOutputOptions {
  /** Override the default `.lisp` → `.ts` path mapping. Paths use `/` separators. */
  readonly outputPath?: (moduleId: string) => string;
}
/** Browser-safe relative paths between generated files (hosts provide POSIX paths). */
export function moduleImportPath(from: string, to: string): string {
  const normalize = (path: string): string[] => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
      else parts.push(part);
    }
    return parts;
  };
  const source = normalize(from).slice(0, -1), target = normalize(to);
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  const path = [...source.map(() => ".."), ...target].join("/");
  return path.startsWith("../") ? path : `./${path}`;
}
