import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  FormaWorkspace,
  getCodeActions,
  getCompletions,
  getDefinition,
  getDiagnostics,
  getHover,
  getReferences,
  toLspDiagnostic,
} from "../src/index.js";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const position = (document: TextDocument, text: string, delta = 0, nth = 0) => {
  let offset = -1;
  for (let count = 0; count <= nth; count++) offset = document.getText().indexOf(text, offset + 1);
  if (offset < 0) throw new Error(`no ${text}`);
  return document.positionAt(offset + delta);
};

async function makeTempDir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "forma-ls-modules-")));
}

describe("Forma language server multi-file modules", () => {
  test("resolves relative .lisp imports for diagnostics, hover, definition, references, and completions", async () => {
    const dir = await makeTempDir();
    const mathPath = join(dir, "math.lisp");
    const mainPath = join(dir, "main.lisp");
    const mathSource = `(export double Point Color)
(type Point {:x Int :y Int})
(type Color (Tagged Red Blue))
(define (double n) (* n 2))
`;
    const mainSource = `(import "./math.lisp" [double Point Color])
(define answer (double 21))
(define origin {:x 0 :y 0})
(define tint Color.Red)
`;
    await writeFile(mathPath, mathSource);
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const mathUri = pathToFileURL(mathPath).href;
    const mainUri = pathToFileURL(mainPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    // Clean diagnostics
    expect(getDiagnostics(workspace, mainDoc).diagnostics).toEqual([]);

    // Hover on imported function
    const hover = getHover(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "double", 1, 1),
    });
    expect(hover).not.toBeNull();
    expect(JSON.stringify(hover?.contents)).toContain("Int -> Int");
    expect(JSON.stringify(hover?.contents)).toContain("math.lisp");

    // Cross-file go-to-definition on call site
    const def = getDefinition(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "double", 1, 1),
    });
    expect(def).toMatchObject({
      uri: mathUri,
      range: { start: { line: 3, character: 9 }, end: { line: 3, character: 15 } },
    });

    // Cross-file go-to-definition on import specifier string
    const specDef = getDefinition(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "./math.lisp", 2),
    });
    expect(specDef).toEqual({
      uri: mathUri,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    });

    // Cross-file references (with math.lisp open as well)
    const mathDoc = TextDocument.create(mathUri, "forma", 1, mathSource);
    await workspace.update(mathDoc);
    const refs = getReferences(workspace, mathDoc, {
      textDocument: { uri: mathUri },
      position: position(mathDoc, "double", 1, 1),
      context: { includeDeclaration: true },
    });
    expect(refs.map((loc) => loc.uri)).toEqual(expect.arrayContaining([mathUri, mainUri]));

    // Completions include imported bindings with their types
    const completions = getCompletions(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "21", 0),
    });
    const byLabel = new Map(completions.items.map((item) => [item.label, item]));
    expect(byLabel.get("double")?.detail).toContain("->");
    expect(byLabel.get("Point")).toBeDefined();
    expect(byLabel.get("Color")).toBeDefined();
  });

  test("resolves namespace (:as) imports for hover, definition, and completions", async () => {
    const dir = await makeTempDir();
    const mathPath = join(dir, "math.lisp");
    const mainPath = join(dir, "main.lisp");
    await writeFile(mathPath, "(export double)\n(define (double n) (* n 2))\n");
    const mainSource = '(import "./math.lisp" :as m)\n(define result (m/double 21))\n';
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const mathUri = pathToFileURL(mathPath).href;
    const mainUri = pathToFileURL(mainPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    expect(getDiagnostics(workspace, mainDoc).diagnostics).toEqual([]);
    const def = getDefinition(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "m/double", 3),
    });
    expect(def?.uri).toBe(mathUri);
    expect(def?.range.start.line).toBe(1);

    const completions = getCompletions(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "21", 0),
    });
    expect(completions.items.some((item) => item.label === "m/double")).toBe(true);
  });

  test("resolves bundled forma:kernel, forma:test, forma:effect, and forma:effect/* libraries", async () => {
    const dir = await makeTempDir();
    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });

    // forma:kernel
    const kernelPath = join(dir, "kernel-use.lisp");
    const kernelSource = `(import "forma:kernel" [when -> and])
(define (check x)
  (when (and (> x 0) (< x 10))
    (-> x (+ 1) (* 2))))
`;
    const kernelDoc = TextDocument.create(pathToFileURL(kernelPath).href, "forma", 1, kernelSource);
    await workspace.update(kernelDoc);
    expect(getDiagnostics(workspace, kernelDoc).diagnostics).toEqual([]);
    const whenDef = getDefinition(workspace, kernelDoc, {
      textDocument: { uri: kernelDoc.uri },
      position: position(kernelDoc, "when", 1, 1),
    });
    expect(whenDef?.uri).toBe("forma:kernel");

    // forma:test
    const testPath = join(dir, "sample-test.lisp");
    const testSource = `(import "forma:test" [test is=])
(test "addition" (is= (+ 1 2) 3))
`;
    const testDoc = TextDocument.create(pathToFileURL(testPath).href, "forma", 1, testSource);
    await workspace.update(testDoc);
    expect(getDiagnostics(workspace, testDoc).diagnostics).toEqual([]);

    // forma:effect
    const effectPath = join(dir, "effect-use.lisp");
    const effectSource = `(import "forma:effect" [do bind pure])
(service Clock (: now (Effect Int)))
(: main (Effect Int [] [Clock.now]))
(define main
  (do
    (bind t Clock.now)
    (pure (+ t 1))))
`;
    const effectDoc = TextDocument.create(pathToFileURL(effectPath).href, "forma", 1, effectSource);
    await workspace.update(effectDoc);
    expect(getDiagnostics(workspace, effectDoc).diagnostics).toEqual([]);

    // forma:effect/rpc
    const rpcPath = join(dir, "rpc-use.lisp");
    const rpcSource = `(import "forma:effect/rpc" [rpc-group rpc])
(export Greetings)
(rpc-group Greetings
  (rpc "Greet" :payload String :success String))
`;
    const rpcDoc = TextDocument.create(pathToFileURL(rpcPath).href, "forma", 1, rpcSource);
    await workspace.update(rpcDoc);
    expect(getDiagnostics(workspace, rpcDoc).diagnostics).toEqual([]);

    // forma:effect/http-api across two files
    const apiPath = join(dir, "api.lisp");
    const handlersPath = join(dir, "handlers.lisp");
    const apiSource = `(import "forma:effect/http-api" [api group endpoint])
(export Health)
(api Health
  (group system
    (endpoint get :get "/health" :success String)))
`;
    const handlersSource = `(import "./api.lisp" [Health])
(import "forma:effect/http-api" [handle handler])
(: health (-> {} (Effect String)))
(define health [request] "ok")
(handle Health system (handler get health))
`;
    await writeFile(apiPath, apiSource);
    await writeFile(handlersPath, handlersSource);
    const handlersDoc = TextDocument.create(pathToFileURL(handlersPath).href, "forma", 1, handlersSource);
    await workspace.update(handlersDoc);
    expect(getDiagnostics(workspace, handlersDoc).diagnostics).toEqual([]);
    const healthDef = getDefinition(workspace, handlersDoc, {
      textDocument: { uri: handlersDoc.uri },
      position: position(handlersDoc, "Health", 1, 1),
    });
    expect(healthDef?.uri).toBe(pathToFileURL(apiPath).href);
  });

  test("unsaved edits in an imported file propagate invalidation and update importer diagnostics", async () => {
    const dir = await makeTempDir();
    const leafPath = join(dir, "leaf.lisp");
    const midPath = join(dir, "mid.lisp");
    const topPath = join(dir, "top.lisp");

    const leafDisk = "(export base)\n(define base 10)\n";
    const midDisk = '(import "./leaf.lisp" [base])\n(export bumped)\n(define bumped (+ base 1))\n';
    const topDisk = '(import "./mid.lisp" [bumped])\n(define total (+ bumped 2))\n';

    await writeFile(leafPath, leafDisk);
    await writeFile(midPath, midDisk);
    await writeFile(topPath, topDisk);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const leafUri = pathToFileURL(leafPath).href;
    const midUri = pathToFileURL(midPath).href;
    const topUri = pathToFileURL(topPath).href;

    const topDoc = TextDocument.create(topUri, "forma", 1, topDisk);
    const midDoc = TextDocument.create(midUri, "forma", 1, midDisk);
    await workspace.update(midDoc);
    await workspace.update(topDoc);

    expect(getDiagnostics(workspace, midDoc).diagnostics).toEqual([]);
    expect(getDiagnostics(workspace, topDoc).diagnostics).toEqual([]);

    // Unsaved edit in leaf.lisp changes `base` from Int to String (disk stays Int)
    const leafEdited = TextDocument.create(leafUri, "forma", 2, '(export base)\n(define base "ten")\n');
    const changed = await workspace.update(leafEdited);
    expect(changed.map((doc) => doc.uri)).toEqual(expect.arrayContaining([leafUri, midUri, topUri]));

    // Both mid.lisp and top.lisp now see the type error from the unsaved overlay
    expect(getDiagnostics(workspace, midDoc).diagnostics.map((d) => d.code)).toContain(
      "typecheck/type-mismatch",
    );
    expect(getDiagnostics(workspace, topDoc).diagnostics.length).toBeGreaterThan(0);

    // Closing leaf.lisp reverts to disk and invalidates mid.lisp and top.lisp back to clean
    const afterClose = await workspace.close(leafUri);
    expect(afterClose.map((doc) => doc.uri)).toEqual(expect.arrayContaining([midUri, topUri]));
    expect(getDiagnostics(workspace, midDoc).diagnostics).toEqual([]);
    expect(getDiagnostics(workspace, topDoc).diagnostics).toEqual([]);
  });

  test("surfaces errors inside imported files with cross-file relatedInformation", async () => {
    const dir = await makeTempDir();
    const brokenPath = join(dir, "broken.lisp");
    const mainPath = join(dir, "main.lisp");

    const brokenSource = '(export value)\n(define value (+ 1 "nope"))\n';
    const mainSource = '(import "./broken.lisp" [value])\n(define x value)\n';
    await writeFile(brokenPath, brokenSource);
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const brokenUri = pathToFileURL(brokenPath).href;
    const mainUri = pathToFileURL(mainPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    const mainDiags = getDiagnostics(workspace, mainDoc).diagnostics;
    expect(mainDiags.length).toBeGreaterThan(0);
    expect(mainDiags[0]?.code).toBe("typecheck/type-mismatch");
    expect(mainDiags[0]?.range.start.line).toBe(0);
    expect(mainDiags[0]?.relatedInformation?.[0]?.location).toMatchObject({
      uri: brokenUri,
      range: { start: { line: 1 } },
    });

    // When broken.lisp is also open, it reports the error directly at line 1
    const brokenDoc = TextDocument.create(brokenUri, "forma", 1, brokenSource);
    await workspace.update(brokenDoc);
    const brokenDiags = getDiagnostics(workspace, brokenDoc).diagnostics;
    expect(brokenDiags.map((d) => [d.code, d.range.start.line])).toContainEqual([
      "typecheck/type-mismatch",
      1,
    ]);
  });

  test("discovers forma.json / forma.lock packages and resolves package imports with overlays", async () => {
    const dir = await makeTempDir();
    const utilDir = join(dir, "util");
    const srcDir = join(dir, "src");
    await mkdir(utilDir, { recursive: true });
    await mkdir(srcDir, { recursive: true });

    const utilManifest = JSON.stringify({ name: "util", exports: { ".": "./lib.lisp" } }, null, 2);
    const utilLib = "(export twice)\n(define (twice n) (* n 2))\n";
    const rootManifest = JSON.stringify(
      { name: "app", exports: { ".": "./src/main.lisp" }, dependencies: { util: "./util" } },
      null,
      2,
    );
    const lock = JSON.stringify(
      {
        version: 1,
        manifest: sha256(rootManifest),
        packages: {
          util: {
            source: "./util",
            resolved: "local",
            commit: null,
            files: {
              "forma.json": sha256(utilManifest),
              "lib.lisp": sha256(utilLib),
            },
          },
        },
      },
      null,
      2,
    );

    const utilLibPath = join(utilDir, "lib.lisp");
    const mainPath = join(srcDir, "main.lisp");
    const mainSource = '(import "util" [twice])\n(define answer (twice 21))\n';

    await writeFile(join(utilDir, "forma.json"), utilManifest);
    await writeFile(utilLibPath, utilLib);
    await writeFile(join(dir, "forma.json"), rootManifest);
    await writeFile(join(dir, "forma.lock"), lock);
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const mainUri = pathToFileURL(mainPath).href;
    const utilLibUri = pathToFileURL(utilLibPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    expect(getDiagnostics(workspace, mainDoc).diagnostics).toEqual([]);

    const hover = getHover(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "twice", 1, 1),
    });
    expect(JSON.stringify(hover?.contents)).toContain("Int -> Int");

    const def = getDefinition(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "twice", 1, 1),
    });
    expect(def).toMatchObject({
      uri: utilLibUri,
      range: { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } },
    });

    // Unsaved overlay in package file invalidates importing document
    const editedUtil = TextDocument.create(
      utilLibUri,
      "forma",
      2,
      "(export twice)\n(: twice (-> String String))\n(define twice [s] (str s s))\n",
    );
    const changed = await workspace.update(editedUtil);
    expect(changed.map((d) => d.uri)).toContain(mainUri);
    expect(getDiagnostics(workspace, mainDoc).diagnostics.map((d) => d.code)).toContain(
      "typecheck/type-mismatch",
    );
  });

  test("resolves project prelude from forma.json and propagates prelude edits", async () => {
    const dir = await makeTempDir();
    const preludePath = join(dir, "prelude.lisp");
    const mainPath = join(dir, "main.lisp");

    const rootManifest = JSON.stringify(
      { name: "app", exports: { ".": "./main.lisp" }, prelude: "./prelude.lisp" },
      null,
      2,
    );
    const preludeSource = "(export base)\n(define base 10)\n";
    const mainSource = "(define total (+ base 5))\n";

    await writeFile(join(dir, "forma.json"), rootManifest);
    await writeFile(preludePath, preludeSource);
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const preludeUri = pathToFileURL(preludePath).href;
    const mainUri = pathToFileURL(mainPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    expect(getDiagnostics(workspace, mainDoc).diagnostics).toEqual([]);

    const def = getDefinition(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      position: position(mainDoc, "base", 1),
    });
    expect(def?.uri).toBe(preludeUri);

    // Edit project prelude in memory -> invalidates main.lisp
    const brokenPrelude = TextDocument.create(preludeUri, "forma", 2, '(export base)\n(define base "ten")\n');
    const changed = await workspace.update(brokenPrelude);
    expect(changed.map((d) => d.uri)).toContain(mainUri);
    expect(getDiagnostics(workspace, mainDoc).diagnostics.map((d) => d.code)).toContain(
      "typecheck/type-mismatch",
    );
  });

  test("code actions preserve cross-file fix targets", async () => {
    const dir = await makeTempDir();
    const helperPath = join(dir, "helper.lisp");
    const mainPath = join(dir, "main.lisp");
    const helperSource = "(export bad)\n(define bad 1)\n";
    const mainSource = '(import "./helper.lisp" [bad])\n(define x bad)\n';
    await writeFile(helperPath, helperSource);
    await writeFile(mainPath, mainSource);

    const workspace = new FormaWorkspace({ workspaceRoot: dir, preludePaths: [] });
    const helperUri = pathToFileURL(helperPath).href;
    const mainUri = pathToFileURL(mainPath).href;
    const mainDoc = TextDocument.create(mainUri, "forma", 1, mainSource);
    await workspace.update(mainDoc);

    const diagnostic = toLspDiagnostic(
      mainDoc,
      {
        code: "test/cross-file-fix",
        severity: "error",
        message: "Fix helper name",
        span: { sourceId: mainUri, startOffset: 25, endOffset: 28 },
        fix: [{ span: { sourceId: helperUri, startOffset: 8, endOffset: 11 }, newText: "good" }],
      },
      workspace,
    );
    const actions = getCodeActions(workspace, mainDoc, {
      textDocument: { uri: mainUri },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.edit?.changes?.[helperUri]).toEqual([
      {
        range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } },
        newText: "good",
      },
    ]);
  });
});
