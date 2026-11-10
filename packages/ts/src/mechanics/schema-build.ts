import { Predicate } from "effect";
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import type { ProgramSource } from "../descriptor/elaborate.js";
import { parse, toSExprMany } from "../reader/index.js";
import { headSym } from "../reader/types.js";
import { mechanicsPackageableDeclarations } from "./artifact.js";
import { generateMechanicsEffectSchemaModule, inlineBrands, orderSchemaDeclarations, schemaTypeTs } from "./effect-schema.js";
import { typeName } from "./naming.js";

export type TypeSchemaBuild =
  | { readonly ok: true; readonly diagnostics: readonly Diagnostic[]; readonly files: Readonly<Record<"schema.ts" | "types.ts" | "schema.json", string>> }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** Generate data codecs and types from an explicit bundle of ordinary `type` declarations. */
export function generateTypeSchemas(sources: readonly ProgramSource[]): TypeSchemaBuild {
  const diagnostics: Diagnostic[] = [];
  const declarations: PackageableDeclaration[] = [];
  for (const {sourceId, source} of sources) {
    const parsed = parse(source);
    for (const error of parsed.errors) diagnostics.push({code:"parse/syntax",severity:"error",phase:"parse",message:error.message,
      ...(error.loc ? {span:{sourceId,startOffset:error.loc.start,endOffset:error.loc.end}} : {})});
    const result = mechanicsPackageableDeclarations(toSExprMany(parsed.redTree).filter(e => headSym(e) === "type"), sourceId);
    if (result.ok) declarations.push(...result.declarations);
    else diagnostics.push(...result.diagnostics.map(d => ({...d,severity:"error" as const,phase:"emit" as const})));
  }
  if (diagnostics.length) return {ok:false,diagnostics};
  const names = new Set<string>();
  const emittedNames = new Set<string>();
  for (const declaration of declarations) {
    const name = declaration.summary.name!;
    if (names.has(name) || emittedNames.has(typeName(name)) || typeName(name) === "Schema") {
      diagnostics.push({code:"schema/duplicate-name",severity:"error",phase:"emit",message:`Type ${name} has a duplicate or reserved generated name.`,span:declaration.span});
    }
    names.add(name);
    emittedNames.add(typeName(name));
  }
  for (const declaration of declarations) {
    const payload = declaration.payload as Record<string, JsonValue>;
    for (const brand of inlineBrands([payload["schema"]!])) names.add(brand.name);
  }
  try {
    const data = declarations.map(declaration => {
      const payload = declaration.payload as Record<string, JsonValue>;
      return {...declaration,payload:{...payload,schema:wireSchema(payload["schema"]!, names)}};
    });
    if (diagnostics.length) return {ok:false,diagnostics};
    const schemas = data.map(declaration => ({name:declaration.summary.name!,schema:declaration.payload.schema}));
    const declared = new Set(schemas.map(s => s.name));
    const brands = inlineBrands(schemas.map(s => s.schema)).filter(b => !declared.has(b.name));
    const ordered = orderSchemaDeclarations([...brands,...schemas]);
    const definitions = new Map(ordered.map(s => [s.name,s.schema]));
    const aliases = (node: JsonValue): readonly string[] => {
      if (!Predicate.isObject(node)) return [];
      if (node["kind"] === "Ref") return [String(node["name"])];
      if (node["kind"] === "Annotated" || node["kind"] === "Brand") return aliases(node["schema"]!);
      return node["kind"] === "Union" ? (node["variants"] as readonly JsonValue[]).flatMap(aliases) : [];
    };
    const cyclic = (name: string, path: ReadonlySet<string>): boolean => path.has(name) ||
      aliases(definitions.get(name)!).some(next => cyclic(next,new Set([...path,name])));
    for (const schema of ordered) if (cyclic(schema.name,new Set())) {
      return {ok:false,diagnostics:[{code:"schema/unsupported",severity:"error",phase:"emit",message:`Recursive type ${schema.name} needs a record, list, map, tuple or tagged constructor.`,
        span:declarations.find(d => d.summary.name === schema.name)?.span}]};
    }
    const types = ordered.map(s => `export type ${typeName(s.name)} = ${schemaTypeTs(s.schema)};`).join("\n") + "\n";
    const defs = Object.fromEntries(ordered.map(s => [s.name,jsonSchema(s.schema,definitions)]));
    return {ok:true,diagnostics:[],files:{
      "schema.ts":generateMechanicsEffectSchemaModule(data).code,
      "types.ts":types,
      "schema.json":JSON.stringify({$schema:"https://json-schema.org/draft/2020-12/schema",$defs:defs},null,2) + "\n",
    }};
  } catch (error) {
    if (!(error instanceof Error) || !("diagnostic" in error)) throw error;
    return {ok:false,diagnostics:[...diagnostics,error.diagnostic as Diagnostic]};
  }
}

/** Data encoding differs from Effect operation results only at the wire boundary. */
function wireSchema(node: JsonValue, names: ReadonlySet<string>, field = false): JsonValue {
  if (Array.isArray(node)) return node.map(item => wireSchema(item,names));
  if (!Predicate.isObject(node)) return node;
  const unsupported = (message: string): never => {
    throw Object.assign(new Error(message), {diagnostic:{code:"schema/unsupported",severity:"error",phase:"emit",message,
      ...(node["span"] ? {span:node["span"] as unknown as Span} : {})}});
  };
  const kind = node["kind"];
  if (kind === "Primitive") {
    if (node["name"] === "Unit") return {...node,name:"Null"};
    if (node["name"] === "Float") return {kind:"Annotated",schema:node,metadata:{finite:true}};
    if (!["String","Int","Bool","Null","Json"].includes(String(node["name"]))) unsupported(`No JSON data encoding for ${node["name"]}.`);
    return node;
  }
  if (kind === "Ref" && !names.has(String(node["name"]))) unsupported(`Unknown schema type ${node["name"]}.`);
  if (kind === "Option" || kind === "Optional" && !field) unsupported("Option is supported only as an optional record field.");
  if (kind && !["Struct","Array","Optional","Map","Ref","Brand","Literal","Tuple","Union","TaggedUnion","Annotated"].includes(String(kind))) unsupported(`No JSON data encoding for ${kind}.`);
  if (kind === "Map" && node["key"] && !(Predicate.isObject(node["key"]) && node["key"]["kind"] === "Primitive" && node["key"]["name"] === "String")) unsupported("Data schema maps require String keys.");
  if (kind === "Annotated" && Predicate.isObject(node["metadata"])) {
    for (const [key,value] of Object.entries(node["metadata"])) {
      if (!["doc","description","title","identifier","pattern","finite","min","max","min-length","max-length"].includes(key)) unsupported(`Unsupported schema refinement :${key}.`);
      if (["min","max","min-length","max-length"].includes(key) && (typeof value !== "number" || !Number.isFinite(value))) unsupported(`:${key} requires a finite number.`);
      if (["min-length","max-length"].includes(key) && (Number(value) < 0 || !Number.isSafeInteger(value))) unsupported(`:${key} requires a nonnegative integer.`);
      if (key === "pattern") {
        if (typeof value !== "string") unsupported(":pattern requires a string.");
        try { new RegExp(String(value)); } catch { unsupported("Invalid :pattern regular expression."); }
      }
    }
  }
  if (kind === "Struct" && Array.isArray(node["fields"])) return {...node,fields:node["fields"].map(entry => {
    const f = entry as Record<string,JsonValue>;
    return {...f,schema:wireSchema(f["schema"]!,names,true)};
  })};
  return Object.fromEntries(Object.entries(node).map(([key,value]) => [key,
    key === "span" || key === "metadata" ? value : wireSchema(value,names,kind === "Annotated" && key === "schema" && field)]));
}

/** JSON Schema is printed from mechanics nodes, never by loading generated code. */
function jsonSchema(node: JsonValue, definitions: ReadonlyMap<string,JsonValue>): JsonValue {
  if (!Predicate.isObject(node)) throw new Error("Expected a mechanics schema node");
  const emit = (schema: JsonValue): JsonValue => jsonSchema(schema,definitions);
  switch (node["kind"]) {
    case "Primitive":
      switch (node["name"]) {
        case "String": return {type:"string"};
        case "Bool": return {type:"boolean"};
        case "Int": return {type:"integer",minimum:Number.MIN_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER};
        case "Float": return {type:"number"};
        case "Null": return {type:"null"};
        case "Json": return {};
      }
      break;
    case "Ref": return {$ref:`#/$defs/${String(node["name"]).replace(/~/g,"~0").replace(/\//g,"~1")}`};
    case "Brand": return {...emit(node["schema"]!) as object,title:node["name"]!};
    case "Array": return {type:"array",items:emit(node["item"]!)};
    case "Optional": return emit(node["item"]!);
    case "Struct": {
      const fields = node["fields"] as readonly Record<string,JsonValue>[];
      const optional = (schema: JsonValue): boolean => Predicate.isObject(schema) &&
        (schema["kind"] === "Optional" || schema["kind"] === "Annotated" && optional(schema["schema"]!));
      return {type:"object",properties:Object.fromEntries(fields.map(f => [String(f["name"]),emit(f["schema"]!)])),
        required:fields.filter(f => !optional(f["schema"]!)).map(f => f["name"]!),additionalProperties:false};
    }
    case "Literal": {
      const values = node["values"] as readonly JsonValue[];
      return values.length === 1 ? {const:values[0]!} : values.length ? {enum:values} : false;
    }
    case "Tuple": {
      const items = node["items"] as readonly JsonValue[];
      return {type:"array",prefixItems:items.map(emit),minItems:items.length,maxItems:items.length,items:false};
    }
    case "Union": return {anyOf:(node["variants"] as readonly JsonValue[]).map(emit)};
    case "TaggedUnion": return {oneOf:(node["variants"] as readonly Record<string,JsonValue>[]).map(variant => {
      const body = emit(variant["schema"]!) as Record<string,JsonValue>;
      const tag = String(node["discriminator"] ?? "tag");
      return {...body,properties:{...body["properties"] as object,[tag]:{const:variant["tag"]!}},required:[tag,...body["required"] as readonly JsonValue[]]};
    })};
    case "Map": {
      return {type:"object",additionalProperties:emit(node["value"]!)};
    }
    case "Annotated": {
      const result = emit(node["schema"]!);
      if (typeof result === "boolean") return result;
      const metadata = node["metadata"] as Record<string,JsonValue>;
      let base = node["schema"];
      const seen = new Set<string>();
      while (Predicate.isObject(base)) {
        if (base["kind"] === "Annotated" || base["kind"] === "Brand") base = base["schema"];
        else if (base["kind"] === "Ref" && !seen.has(String(base["name"]))) {
          seen.add(String(base["name"]));
          base = definitions.get(String(base["name"]));
        } else break;
      }
      const array = Predicate.isObject(base) && base["kind"] === "Array";
      const keys: Record<string,string> = {doc:"description",description:"description",title:"title",pattern:"pattern",min:"minimum",max:"maximum","min-length":array ? "minItems" : "minLength","max-length":array ? "maxItems" : "maxLength"};
      const annotations = Object.fromEntries(Object.entries(metadata).filter(([key]) => keys[key]).map(([key,value]) => [keys[key]!,value]));
      if (Predicate.isObject(result)) {
        if (typeof result["minimum"] === "number" && typeof annotations["minimum"] === "number") annotations["minimum"] = Math.max(result["minimum"],annotations["minimum"]);
        if (typeof result["maximum"] === "number" && typeof annotations["maximum"] === "number") annotations["maximum"] = Math.min(result["maximum"],annotations["maximum"]);
      }
      return {...result as object,...annotations};
    }
  }
  throw new Error(`Unsupported mechanics schema ${node["kind"]}`);
}
