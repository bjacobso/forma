import { copyFile, mkdir } from "node:fs/promises";

// Ship the portable engine; consumers should not need OCaml or this checkout.
const source = new URL("../../ocaml/dist/js/jsoo_entry.cjs", import.meta.url);
const destination = new URL("../dist/runtime/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(source, new URL("jsoo_entry.cjs", destination));
