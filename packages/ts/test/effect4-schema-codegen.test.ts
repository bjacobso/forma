import { describe, expect, test } from "vitest";
import { Schema } from "effect";
import ts from "typescript";
import { resolve } from "node:path";
import { emitProtocolInterface, emitProtocolObjectSchema } from "../src/descriptor/protocol-effect-schema.js";
import type { ProtocolObjectDescriptor } from "../src/descriptor/protocol-descriptor.js";
import { elaborateEffectProgram, generateMechanicsEffectSchemaModule, generateTypeSchemas } from "../src/Mechanics.js";

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
  test("data schema builds agree on recursive, refined, optional and nonempty data", () => {
    const sources = [
      {sourceId:"slug.lisp",source:'(type Slug (String :pattern "^[a-z]+$" :min-length 2))'},
      {sourceId:"node.lisp",source:'(type Node {:name Slug :note (Option String) :tags (List String :min-length 1) :count (Int :min 1 :max 9) :state (Union :ready :done) :unit Unit :children (List Node) :links (List Link)})'},
      {sourceId:"link.lisp",source:'(type Link {:node Node :weight Int})'},
    ];
    const result = generateTypeSchemas(sources);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generateTypeSchemas(sources)).toEqual(result);
    expect(result.files["types.ts"]).toContain("readonly [string, ...(string)[]]");
    const json = JSON.parse(result.files["schema.json"]);
    expect(json.$defs.Node.required).toEqual(["name","tags","count","state","unit","children","links"]);
    expect(json.$defs.Node.properties.tags).toEqual({type:"array",items:{type:"string"},minItems:1});
    expect(json.$defs.Node.properties.children.items).toEqual({$ref:"#/$defs/Node"});
    expect(json.$defs.Slug).toEqual({type:"string",pattern:"^[a-z]+$",minLength:2});
    const schemaPath = resolve(import.meta.dirname,"schema.ts"), typesPath = resolve(import.meta.dirname,"types.ts");
    const files = new Map([[schemaPath,result.files["schema.ts"] + '\nconst typed: Schema.Codec<import("./types.js").Node> = NodeSchema;'],[typesPath,result.files["types.ts"]]]);
    const options: ts.CompilerOptions = {target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,exactOptionalPropertyTypes:true,skipLibCheck:true,noEmit:true};
    const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile, fileExists = host.fileExists;
    host.fileExists = name => files.has(name) || fileExists(name);
    host.getSourceFile = (name,...args) => files.has(name) ? ts.createSourceFile(name,files.get(name)!,ts.ScriptTarget.ESNext) : getSourceFile(name,...args);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()],options,host)).map(d => ts.flattenDiagnosticMessageText(d.messageText,"\n"))).toEqual([]);
    const js = ts.transpileModule(result.files["schema.ts"].replace(/^import .*$/gm, "").replace(/^export /gm, ""), {
      compilerOptions: {target:ts.ScriptTarget.ESNext},
    }).outputText;
    const schema = new Function("Schema", `${js}\nreturn NodeSchema;`)(Schema) as Schema.Codec<unknown>;
    const leaf = {name:"leaf",tags:["x"],count:3,state:"ready",unit:null,children:[],links:[]};
    const value = {...leaf,name:"root",links:[{node:leaf,weight:2}]};
    expect(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value))).toEqual(value);
    for (const patch of [{name:"X"},{tags:[]},{count:0},{count:10},{state:"unknown"},{unit:undefined}]) {
      expect(() => Schema.decodeUnknownSync(schema)({...value,...patch})).toThrow();
    }
  });

  test("unsupported data types fail with source spans instead of emitting Unknown", () => {
    const source = '(type Bad {:value Missing})';
    const result = generateTypeSchemas([{sourceId:"bad.lisp",source}]);
    expect(result).toMatchObject({ok:false,diagnostics:[{code:"schema/unsupported",span:{sourceId:"bad.lisp"}}]});
    const span = result.diagnostics[0]!.span!;
    expect(source.slice(span.startOffset,span.endOffset)).toBe("Missing");
    expect(span).toMatchObject({startLine:1,startColumn:19,endLine:1,endColumn:26});
  });

  test("standalone mechanics schemas load and round-trip recursive records", () => {
    const result = elaborateEffectProgram('(type Node {:name String :children (List Node)})');
    expect(result.diagnostics).toEqual([]);
    const {code} = generateMechanicsEffectSchemaModule(result.declarations);
    const js = ts.transpileModule(code.replace(/^import .*$/gm, "").replace(/^export /gm, ""), {
      compilerOptions: { target: ts.ScriptTarget.ESNext },
    }).outputText;
    const schema = new Function("Schema", `${js}\nreturn NodeSchema;`)(Schema) as Schema.Codec<unknown>;
    const value = {name:"root",children:[{name:"leaf",children:[]}]};
    expect(Schema.decodeUnknownSync(schema)(value)).toEqual(value);
    expect(Schema.encodeSync(schema)(value)).toEqual(value);
    expect(() => Schema.decodeUnknownSync(schema)({name:"root",children:[{name:1,children:[]}]})).toThrow();
  });

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
