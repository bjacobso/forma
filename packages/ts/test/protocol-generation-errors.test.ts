import { expect, test } from "vitest";
import { ProtocolGenerationError, emitProtocolModuleImports, requiredProtocolUnion, requiredProtocolObject, requiredProtocolTypeAlias, requiredProtocolEnum, requiredProtocolModule, type ProtocolModuleDescriptor } from "../src/Descriptor.js";

test("protocol generator inputs identify missing collections and module specifiers", () => {
  const module: ProtocolModuleDescriptor = { kind: "module", descriptorName: "api", name: "Api", types: [], enums: [], objects: [], unions: [], imports: [{name: "Thing", from: "shared", typeOnly: false}], literalSchemas: [], extensionKey: "protocol-module" };
  for (const [run, path] of [
    [() => emitProtocolModuleImports(module, {moduleSpecifiers: {}}), 'options.moduleSpecifiers["shared"]'],
    [() => requiredProtocolUnion([], "Missing"), "unions"],
    [() => requiredProtocolObject([], "Missing"), "objects"],
    [() => requiredProtocolTypeAlias([], "Missing"), "aliases"],
    [() => requiredProtocolEnum([], "Missing"), "enums"],
    [() => requiredProtocolModule([], "Missing"), "modules"],
  ] as const) {
    try { run(); expect.fail("Expected invalid generator input to fail"); }
    catch (error) {
      expect(error).toBeInstanceOf(ProtocolGenerationError);
      expect(error).toMatchObject({name: "ProtocolGenerationError", code: "descriptor/invalid-generator-input", path});
      expect(error).not.toHaveProperty("span");
    }
  }
});
