import { describe, expect, test } from "vitest";
import { Schema } from "effect";
import ts from "typescript";
import { resolve } from "node:path";
import { emitProtocolInterface, emitProtocolObjectSchema } from "../src/descriptor/protocol-effect-schema.js";
import type { ProtocolObjectDescriptor } from "../src/descriptor/protocol-descriptor.js";

const object: ProtocolObjectDescriptor = {
  kind: "object",
  descriptorName: "Payload",
  name: "Payload",
  schemaName: "PayloadSchema",
  extensionKey: "protocol/object",
  fields: [{
    name: "labels",
    type: { kind: "record", value: { kind: "string" } },
    required: true,
    aliases: [],
  }],
};

describe("Effect 4 protocol schema projection", () => {
  test("typechecks and decodes the emitted record schema", () => {
    const code = [
      'import { Schema } from "effect";',
      ...emitProtocolInterface(object),
      ...emitProtocolObjectSchema(object),
    ].join("\n");
    const file = resolve(import.meta.dirname, "generated-protocol.ts");
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (name, languageVersionOrOptions, onError, shouldCreateNewSourceFile) =>
      name === file
        ? ts.createSourceFile(name, code, ts.ScriptTarget.ESNext)
        : originalGetSourceFile(name, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);

    const js = ts.transpileModule(code.replace('import { Schema } from "effect";', ""), {
      compilerOptions: { target: ts.ScriptTarget.ESNext },
    }).outputText.replace(/^export \{\};?$/m, "");
    const generated = new Function("Schema", `${js}\nreturn PayloadSchema;`)(Schema) as Schema.Codec<Payload>;
    expect(Schema.decodeUnknownSync(generated)({ labels: { team: "forma" } })).toEqual({
      labels: { team: "forma" },
    });
    expect(() => Schema.decodeUnknownSync(generated)({ labels: { team: 1 } })).toThrow();
  });
});

interface Payload {
  readonly labels: Readonly<Record<string, string>>;
}
