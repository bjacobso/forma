import { describe, expect, test } from "vitest";
import { analyze, definition } from "./analysis";

const domain = `(export Order Missing)
(type Order {:id String})
(error Missing {:id String})`;
const rpc = `(import "./domain.lisp" [Order Missing])
(import "forma:effect/rpc" [rpc-group rpc])
(rpc-group Orders (rpc "Get" :payload {:id String} :success Order :error Missing))`;
const files = [{ id: "rpc.lisp", source: rpc }, { id: "domain.lisp", source: domain }];

describe("reading editor analysis across files", () => {
  test("types a file with the files it imports in scope, and sees edits to them", () => {
    expect(analyze(files, "rpc.lisp").diagnostics).toEqual([]);
    const renamed = files.map(file => file.id === "domain.lisp" ? { ...file, source: domain.replace("(type Order ", "(type Purchase ") } : file);
    expect(analyze(renamed, "rpc.lisp").diagnostics.map(d => d.message)).toContain("Unknown type Order");
  });

  test("reports an import of a name the other file does not export", () => {
    const source = rpc.replace("[Order Missing]", "[Order Missing Nope]");
    const codes = analyze([{ id: "rpc.lisp", source }, files[1]!], "rpc.lisp").diagnostics.map(d => d.code);
    expect(codes).toContain("module/private-export");
  });

  test("goes to a definition in another file, and from a form head to its prelude", () => {
    const toOrder = definition(files, "rpc.lisp", rpc.indexOf("Order :error"));
    expect(toOrder && { file: toOrder.file, text: domain.slice(toOrder.from, toOrder.to) }).toEqual({ file: "domain.lisp", text: "Order" });
    const toForm = definition(files, "rpc.lisp", rpc.indexOf("(rpc \"Get\"") + 1);
    expect(toForm?.file).toBe("forma:rpc.lisp");
    expect(toForm?.source?.slice(toForm.formFrom, toForm.formFrom + 11)).toBe("(form (rpc ");
  });
});
