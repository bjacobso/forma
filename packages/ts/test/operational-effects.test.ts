import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Mechanics, Reader, Type } from "../src/index.js";

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../conformance/operational-effects",
);
const source = readFileSync(resolve(fixtureDir, "program.lisp"), "utf8");
const golden = JSON.parse(readFileSync(resolve(fixtureDir, "expected.json"), "utf8")) as {
  readonly types: { readonly typescript: string };
  readonly serviceCapability: string;
  readonly failedErrorType: string;
  readonly caughtErrorType: string;
  readonly authorityCapabilities: readonly string[];
  readonly effectBodies: Readonly<Record<string, unknown>>;
};

function effectBodyShape(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const node = value as Record<string, unknown>;
  switch (node["kind"]) {
    case "Fail":
      return { kind: "Fail", errorType: (node["error"] as Record<string, unknown>)["errorType"] };
    case "Catch":
      return { kind: "Catch", errorType: node["errorType"], body: effectBodyShape(node["body"]), handler: effectBodyShape(node["handler"]) };
    case "Do":
      return { kind: "Do", bindings: (node["bindings"] as readonly Record<string, unknown>[]).map((binding) => ({ name: binding["name"], value: effectBodyShape(binding["value"]) })), body: effectBodyShape(node["body"]) };
    case "ServiceCall":
      return { kind: "ServiceCall", service: node["service"], method: node["method"] };
    case "OperationCall":
      return { kind: "OperationCall", operation: node["operation"] };
    default:
      return { kind: node["kind"] };
  }
}

function declarations() {
  const exprs = Effect.runSync(Reader.parseManyToSExpr(source));
  const result = Mechanics.mechanicsPackageableDeclarations(exprs, "effects/conformance");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
  return result.declarations;
}

describe("operational Effect contract", () => {
  test("typechecks constructed failures, typed catch, and operation capabilities", async () => {
    await expect(Effect.runPromise(Type.inferSourceStr(source))).resolves.toBe(
      golden.types.typescript,
    );
  });

  test("projects Catch and Error nodes into portable mechanics IR", () => {
    const projected = declarations();
    const service = projected.find((item) => item.summary.name === "Console");
    const fail = projected.find((item) => item.summary.name === "always-fail");
    const recover = projected.find((item) => item.summary.name === "recover");

    expect(service?.payload).toMatchObject({
      kind: "ServiceDef",
      methods: [{ name: "print", effect: { requirements: [golden.serviceCapability] } }],
    });
    expect(fail?.payload).toMatchObject({
      kind: "EffectDef",
      body: {
        kind: "Fail",
        error: { kind: "Error", errorType: golden.failedErrorType },
      },
    });
    expect(recover?.payload).toMatchObject({
      kind: "EffectDef",
      body: {
        kind: "Catch",
        errorType: golden.caughtErrorType,
        binding: "error",
      },
    });
    const log = projected.find((item) => item.summary.name === "log");
    expect(log?.payload).toMatchObject({
      authority: { capabilities: golden.authorityCapabilities },
    });
    for (const [name, expected] of Object.entries(golden.effectBodies)) {
      const operation = projected.find((item) => item.summary.name === name);
      expect(effectBodyShape((operation?.payload as Record<string, unknown> | undefined)?.["body"])).toEqual(expected);
    }
  });

  test("runs typed recovery and enforces operation-granular provisioning", async () => {
    const projected = declarations();
    const runtime = Mechanics.makeMechanicsRuntime({
      declarations: projected,
      services: {
        Console: {
          print: () => null,
        },
      },
    });

    await expect(runtime.invoke("recover", ["offline"])).resolves.toBeNull();
    await expect(runtime.invoke("log", ["hello"])).resolves.toBeNull();
    await expect(runtime.invoke("always-fail", ["offline"])).rejects.toMatchObject({
      errorType: "ConsoleUnavailable",
      errorValue: { _tag: "ConsoleUnavailable", message: "offline" },
    });

    const missing = Mechanics.makeMechanicsRuntime({ declarations: projected, services: {} });
    await expect(missing.invoke("log", ["hello"])).rejects.toMatchObject({
      code: "mechanics/missing-capability",
      details: { capability: "Console.print" },
    });
  });

  test("rejects impossible catches and legacy resumable forms", async () => {
    const impossible = `
      (define-error Missing (:fields (field id String)))
      (catch (succeed 1) (Missing error) (succeed 0))
    `;
    await expect(Effect.runPromise(Type.inferSourceStr(impossible))).rejects.toThrow(
      /Impossible catch/,
    );
    await expect(
      Effect.runPromise(Type.inferSourceStr("(perform Console.print \"hello\")")),
    ).rejects.toThrow(/Legacy algebraic effect form/);
    await expect(
      Effect.runPromise(Type.inferSourceStr("(fail (UndeclaredError {}))")),
    ).rejects.toThrow(/Unknown error type UndeclaredError/);
  });
});
