import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { packageDir } from "./corpus.mjs";

export const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");

export const requireNativeCli = () => {
  if (existsSync(nativeCli)) return nativeCli;

  throw new Error(
    "Missing dist/native/forma_cli.exe. Run through Turbo so @formalang/ocaml#build completes first.",
  );
};
