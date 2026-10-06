/** File adapter for stage-1 linking. No project/package configuration. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readModuleGraph } from "../packages/ts/dist/Node.mjs";
import {
  NodeOcamlLanguageHost,
  TsLanguageHost,
} from "../packages/host/dist/index.mjs";

const [entry, output, engine = "native"] = process.argv.slice(2);
if (!entry || !output || !["native", "ts"].includes(engine)) {
  console.error(
    "Usage: node scripts/link-forma-modules.mjs <entry.forma> <output-directory> [native|ts]",
  );
  process.exit(64);
}
const graph = readModuleGraph(entry);
const host =
  engine === "native"
    ? new NodeOcamlLanguageHost({
        cliPath: resolve("packages/ocaml/dist/native/forma_cli.exe"),
      })
    : new TsLanguageHost();
const { sessionId } = await host.openSession();
try {
  const loaded = await host.loadSourceBundle({
    sessionId,
    sources: graph.modules.map((m) => ({
      kind: "source",
      sourceId: m.id,
      source: m.source,
    })),
  });
  const linked = await host.linkEffectModules({
    sessionId,
    sourceId: graph.entry,
  });
  const diagnostics = [...loaded.diagnostics, ...linked.diagnostics];
  if (diagnostics.some((d) => d.severity === "error")) {
    console.error(JSON.stringify(diagnostics, null, 2));
    process.exitCode = 1;
  } else {
    mkdirSync(output, { recursive: true });
    for (const module of linked.modules)
      writeFileSync(resolve(output, module.fileName), module.code);
    writeFileSync(
      resolve(output, "interfaces.json"),
      JSON.stringify(linked.interfaces, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { entry: linked.entry, interfaces: linked.interfaces },
        null,
        2,
      ),
    );
  }
} finally {
  await host.closeSession({ sessionId });
}
