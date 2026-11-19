import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { commands, workspace, type ExtensionContext } from "vscode";
import { LanguageClient, type Executable } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.push(
    commands.registerCommand("forma.restartServer", async () => {
      await client?.stop();
      await start();
    }),
  );
  await start();
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}

async function start(): Promise<void> {
  const server = serverCommand();
  client = new LanguageClient("forma", "Forma", server, {
    documentSelector: [{ language: "forma" }],
  });
  client.outputChannel.appendLine(`Starting: ${[server.command, ...(server.args ?? [])].join(" ")}`);
  await client.start();
}

/**
 * The server comes from the `@forma-language/forma` package, so it matches the
 * engine version the project checks with. Lookup order: the user's command,
 * the project's installed package, then npx with the package's optional LSP peers.
 */
function serverCommand(): Executable {
  const config = workspace.getConfiguration("forma");
  const preludes = config.get<string[]>("preludes", []);
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  const options = {
    env: { ...process.env, ...(preludes.length ? { FORMA_LANGUAGE_SERVER_PRELUDES: preludes.join(",") } : {}) },
    ...(root ? { cwd: root } : {}),
    // npx and package-manager shims are .cmd files on Windows.
    shell: process.platform === "win32",
  };
  const custom = config.get<string[]>("server.command", []);
  if (custom.length > 0) return { command: custom[0]!, args: custom.slice(1), options };

  for (const folder of workspace.workspaceFolders ?? []) {
    const server = installedServer(folder.uri.fsPath);
    if (server) return { command: config.get("server.node", "node"), args: [server, "--stdio"], options };
  }
  return {
    command: "npx",
    args: [
      "--yes",
      "--package=@forma-language/forma",
      "--package=vscode-languageserver@^9.0.1",
      "--package=vscode-languageserver-textdocument@^1.0.12",
      "--",
      "forma-language-server",
      "--stdio",
    ],
    options,
  };
}

/** The nearest installed `@forma-language/forma` server at or above `directory`. */
function installedServer(directory: string): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    const server = join(current, "node_modules/@forma-language/forma/dist/forma-language-server.mjs");
    if (existsSync(server)) return server;
    if (dirname(current) === current) return undefined;
  }
}
