import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const cwd = new URL("..", import.meta.url);
const dist = new URL("dist/", cwd);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    ...options,
  });

  if (result.error?.code === "ENOENT") {
    console.error(
      `Missing required command: ${command}. Install OCaml and Dune before building @formalang/ocaml.`,
    );
    process.exit(127);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const canRun = (command, args) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
};

const hasOpamDune = canRun("opam", ["exec", "--", "dune", "--version"]);

const runDune = (args) => {
  if (hasOpamDune) {
    run("opam", ["exec", "--", "dune", ...args]);
    return;
  }

  run("dune", args);
};

const hasTool = (tool) => {
  if (hasOpamDune) {
    return canRun("opam", ["exec", "--", "which", tool]);
  }

  return canRun("which", [tool]);
};

const stripSourceMapComment = (file) => {
  const source = readFileSync(file, "utf8");
  chmodSync(file, 0o644);
  writeFileSync(file, source.replace(/\n\/\/# sourceMappingURL=.*\n?$/u, "\n"));
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(new URL("native/", dist), { recursive: true });

const targets = {
  native: true,
  js: false,
  wasm: false,
};

runDune(["build", "bin/forma_cli.exe"]);
copyFileSync(
  new URL("_build/default/bin/forma_cli.exe", cwd),
  new URL("native/forma_cli.exe", dist),
);

if (hasTool("js_of_ocaml")) {
  mkdirSync(new URL("js/", dist), { recursive: true });
  runDune(["build", "js/jsoo_entry.bc.js"]);
  copyFileSync(
    new URL("_build/default/js/jsoo_entry.bc.js", cwd),
    new URL("js/jsoo_entry.cjs", dist),
  );
  stripSourceMapComment(new URL("js/jsoo_entry.cjs", dist));
  targets.js = true;
}

if (hasTool("wasm_of_ocaml")) {
  mkdirSync(new URL("wasm/", dist), { recursive: true });
  runDune(["build", "wasm/wasm_entry.bc.wasm.js"]);
  copyFileSync(
    new URL("_build/default/wasm/wasm_entry.bc.wasm.js", cwd),
    new URL("wasm/wasm_entry.cjs", dist),
  );
  stripSourceMapComment(new URL("wasm/wasm_entry.cjs", dist));

  const assets = new URL("_build/default/wasm/wasm_entry.bc.wasm.assets/", cwd);
  if (existsSync(assets)) {
    cpSync(assets, new URL("wasm/wasm_entry.bc.wasm.assets/", dist), {
      recursive: true,
    });
  }
  targets.wasm = true;
}

writeFileSync(new URL("build-targets.json", dist), `${JSON.stringify(targets, null, 2)}\n`);
