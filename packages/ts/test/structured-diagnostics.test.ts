import { describe, expect, test } from "vitest";
import { bootstrapFromSources, elaborateProgram } from "../src/Descriptor.js";
import { DiagnosticCatalog, diagnosticCatalog, hasDiagnosticCode, diagnosticFromUnknown, KernelTypeError, ArityError } from "../src/Diagnostic.js";

declare module "../src/Diagnostic.js" {
  interface DiagnosticDetailsMap {
    "world/role-name": { readonly name: string; readonly candidates: readonly string[] };
  }
}

const prelude = bootstrapFromSources("", `
(type Choice (Union :open :closed))
(type ItemIR {:kind "Item" :name Symbol})
(form (item name choice fields)
  :types {:name (Declares Item) :choice Choice :fields (Record Type)}
  :ir ItemIR
  {:kind "Item" :name name})
`);

describe("structured consumer diagnostics", () => {
  test("consumer check diagnostics keep structured data, advice and atomic edits", () => {
    const custom = bootstrapFromSources("", `
(type RoleIR {:kind "Role" :name Symbol})
(form (role name)
  :types {:name (Declares Role)} :ir RoleIR
  :check (fn [holes] [{:code "world/role-name" :message "Choose a role name"
    :details {:name (str (get holes :name)) :candidates ["Admin"]}
    :help "Use Admin." :at [:name]
    :fix [{:at [:name] :new-text "Admin"}]}])
  {:kind "Role" :name name})`);
    const result = elaborateProgram("(role Admn)", {prelude:custom,sourceId:"roles.forma"});
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic).toMatchObject({code:"world/role-name",details:{name:"Admn",candidates:["Admin"]},help:"Use Admin.",fix:[{newText:"Admin",span:{sourceId:"roles.forma",startOffset:6,endOffset:10}}]});
    if (!hasDiagnosticCode(diagnostic, "world/role-name")) throw new Error("wrong consumer code");
    const candidates: readonly string[] = diagnostic.details!.candidates;
    expect(candidates).toEqual(["Admin"]);
    const catalog = new DiagnosticCatalog();
    catalog.register({code:diagnostic.code,summary:"Choose a role name.",explanation:"Declare the named role.",stability:"stable"});
    expect(catalog.get(diagnostic.code)?.explanation).toBe("Declare the named role.");
    catalog.assertKnown(diagnostic);
  });

  test("kernel failures retain typed names and expected/actual values", () => {
    expect(diagnosticFromUnknown(new ArityError({name:"lookup",expected:2,got:3}), "evaluate", "world.forma").details).toMatchObject({name:"lookup",expected:2,actual:3});
    expect(diagnosticFromUnknown(new KernelTypeError({message:"Wrong value",expected:"String",got:"Int"}), "evaluate", "world.forma").details).toMatchObject({expected:"String",actual:"Int"});
  });

  test("an offered fix replaces only the misspelled form head in its source", () => {
    const source = "(itme A :open {})";
    const diagnostic = elaborateProgram(source, {prelude,sourceId:"world.forma"}).diagnostics[0]!;
    expect(diagnostic.help).toContain("item");
    expect(diagnostic.fix).toEqual([{span:expect.objectContaining({sourceId:"world.forma",startOffset:1,endOffset:5}),newText:"item"}]);
    const edit = diagnostic.fix![0]!;
    const fixed = source.slice(0,edit.span.startOffset)+edit.newText+source.slice(edit.span.endOffset);
    expect(elaborateProgram(fixed,{prelude}).diagnostics).toEqual([]);
  });

  test("a consumer extends the same catalog without replacing engine entries", () => {
    const catalog = new DiagnosticCatalog();
    const entry = { code: "world/unknown-role", summary: "The role is not declared.", explanation: "Declare the role before referring to it.", stability: "stable" as const };
    catalog.register(entry);
    expect(catalog.get(entry.code)).toEqual(entry);
    expect(catalog.get("elaborate/unknown-form")).toEqual(diagnosticCatalog.get("elaborate/unknown-form"));
    expect(() => catalog.register(entry)).toThrow("already registered");
    expect(() => catalog.assertKnown({ code: "world/unregistered" })).toThrow("world/unregistered");
    expect(catalog.get("world/missing")).toBeUndefined();
  });

  test("known codes narrow details without making message text an API", () => {
    const diagnostic = elaborateProgram("(itme A :open {})", { prelude }).diagnostics[0]!;
    if (!hasDiagnosticCode(diagnostic, "elaborate/unknown-form")) throw new Error("wrong code");
    const names: readonly string[] = diagnostic.details!.candidates;
    expect(names).toContain("item");
    diagnosticCatalog.assertKnown(diagnostic);
  });

  test("unknown forms expose the name and all considered forms without parsing prose", () => {
    const result = elaborateProgram("(itme A :open {})", { prelude, sourceId: "world.forma" });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "elaborate/unknown-form",
      details: { form: "itme", name: "itme", candidates: ["Choice", "ItemIR", "item"] },
    });
  });

  test("invalid enum values expose the hole, candidates and expected/actual syntax", () => {
    const result = elaborateProgram("(item A :opne {})", { prelude });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "elaborate/hole-type",
      details: { form: "item", hole: "choice", name: ":opne", candidates: [":open", ":closed"], expected: "Choice", actual: ":opne" },
    });
  });

  test("unknown nested types expose their name at the offending symbol", () => {
    const source = "(item A :open {:x (List Strnig)})";
    const result = elaborateProgram(source, { prelude, sourceId: "world.forma" });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "elaborate/hole-type",
      details: { form: "item", hole: "fields", name: "Strnig", expected: "Type", actual: "Strnig", candidates: expect.arrayContaining(["String", "ItemIR", "Choice"]) },
      span: { sourceId: "world.forma", startOffset: source.indexOf("Strnig"), endOffset: source.indexOf("Strnig") + 6 },
    });
  });
});
