import { describe, expect, test } from "vitest";
import {
  decideDataRelation,
  isLiteralAssignableToLiteral,
  isLiteralAssignableToPrimitive,
  isNumericPrimitive,
  isPrimitiveAssignable,
  isPrimitiveName,
  joinNumericPrimitives,
  literalBaseName,
  literalBasePrimitive,
  parseLiteralTypeName,
  type DataLiteral,
  type DataNode,
} from "../src/type/data-relation.js";

const prim = (name: string): DataNode<string> => ({ kind: "prim", name, raw: name });
const lit = (literal: DataLiteral, raw = JSON.stringify(literal.value)): DataNode<string> => ({
  kind: "literal",
  literal,
  raw,
});
const brand = (name: string, base: string): DataNode<string> => ({
  kind: "brand",
  name,
  base,
  raw: `Brand<${name}, ${base}>`,
});
const option = (item: string): DataNode<string> => ({
  kind: "option",
  item,
  raw: `Option<${item}>`,
});
const unknownNode: DataNode<string> = { kind: "unknown", raw: "Unknown" };
const neverNode: DataNode<string> = { kind: "never", raw: "Never" };
const other = (raw: string): DataNode<string> => ({ kind: "other", raw });

describe("shared data-type relation", () => {
  test("primitives preserve Int -> Float directionality and reject Float -> Int", () => {
    expect(isPrimitiveName("Int")).toBe(true);
    expect(isPrimitiveName("Float")).toBe(true);
    expect(isPrimitiveName("String")).toBe(true);
    expect(isPrimitiveName("CustomType")).toBe(false);

    expect(isNumericPrimitive("Int")).toBe(true);
    expect(isNumericPrimitive("Float")).toBe(true);
    expect(isNumericPrimitive("String")).toBe(false);

    expect(isPrimitiveAssignable("Int", "Int")).toBe(true);
    expect(isPrimitiveAssignable("Int", "Float")).toBe(true);
    expect(isPrimitiveAssignable("Float", "Float")).toBe(true);
    expect(isPrimitiveAssignable("Float", "Int")).toBe(false);
    expect(isPrimitiveAssignable("String", "Int")).toBe(false);

    expect(joinNumericPrimitives("Int", "Int")).toBe("Int");
    expect(joinNumericPrimitives("Int", "Float")).toBe("Float");
    expect(joinNumericPrimitives("Float", "Int")).toBe("Float");
    expect(joinNumericPrimitives("Float", "Float")).toBe("Float");
    expect(joinNumericPrimitives("String", "Int")).toBeUndefined();

    expect(decideDataRelation(prim("Int"), prim("Float"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(prim("Float"), prim("Int"))).toEqual({ verdict: "reject" });
    expect(decideDataRelation(prim("String"), prim("String"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(prim("String"), prim("Bool"))).toEqual({ verdict: "reject" });
  });

  test("literals parse, widen, and check directionally against primitives and literals", () => {
    expect(parseLiteralTypeName('"admin"')).toEqual({ kind: "string", value: "admin" });
    expect(parseLiteralTypeName(":ready")).toEqual({ kind: "keyword", value: ":ready" });
    expect(parseLiteralTypeName("true")).toEqual({ kind: "boolean", value: true });
    expect(parseLiteralTypeName("42")).toEqual({ kind: "int", value: 42 });
    expect(parseLiteralTypeName("1.5")).toEqual({ kind: "float", value: 1.5 });
    expect(parseLiteralTypeName("1.0")).toEqual({ kind: "float", value: 1 });
    expect(parseLiteralTypeName("User")).toBeUndefined();

    expect(literalBaseName('"admin"')).toBe("String");
    expect(literalBaseName(":ready")).toBe("Keyword");
    expect(literalBaseName("false")).toBe("Bool");
    expect(literalBaseName("42")).toBe("Int");
    expect(literalBaseName("1.0")).toBe("Float");
    expect(literalBasePrimitive({ kind: "int", value: 7 })).toBe("Int");

    expect(isLiteralAssignableToPrimitive({ kind: "int", value: 7 }, "Int")).toBe(true);
    expect(isLiteralAssignableToPrimitive({ kind: "int", value: 7 }, "Float")).toBe(true);
    expect(isLiteralAssignableToPrimitive({ kind: "float", value: 1.5 }, "Float")).toBe(true);
    expect(isLiteralAssignableToPrimitive({ kind: "float", value: 1.5 }, "Int")).toBe(false);
    expect(isLiteralAssignableToPrimitive({ kind: "float", value: 1.0 }, "Int")).toBe(false);
    expect(isLiteralAssignableToPrimitive({ kind: "string", value: "a" }, "String")).toBe(true);
    expect(isLiteralAssignableToPrimitive({ kind: "string", value: "a" }, "Keyword")).toBe(false);
    expect(isLiteralAssignableToPrimitive({ kind: "keyword", value: ":a" }, "Keyword")).toBe(true);

    expect(isLiteralAssignableToLiteral({ kind: "int", value: 1 }, { kind: "int", value: 1 })).toBe(true);
    expect(isLiteralAssignableToLiteral({ kind: "int", value: 1 }, { kind: "float", value: 1 })).toBe(true);
    expect(isLiteralAssignableToLiteral({ kind: "float", value: 1 }, { kind: "int", value: 1 })).toBe(false);
    expect(isLiteralAssignableToLiteral({ kind: "string", value: "a" }, { kind: "string", value: "b" })).toBe(false);

    expect(decideDataRelation(lit({ kind: "int", value: 5 }), prim("Float"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(lit({ kind: "float", value: 1.5 }), prim("Int"))).toEqual({ verdict: "reject" });
    expect(decideDataRelation(prim("String"), lit({ kind: "string", value: "admin" }))).toEqual({ verdict: "reject" });
  });

  test("brands are nominal against brands and unwrap to their base against non-brands", () => {
    expect(decideDataRelation(brand("UserId", "String"), brand("UserId", "String"))).toEqual({
      verdict: "accept",
    });
    expect(decideDataRelation(brand("OrderId", "String"), brand("UserId", "String"))).toEqual({
      verdict: "reject",
    });
    expect(decideDataRelation(prim("String"), brand("UserId", "String"))).toEqual({
      verdict: "reject",
    });
    expect(decideDataRelation(lit({ kind: "string", value: "u1" }), brand("UserId", "String"))).toEqual({
      verdict: "reject",
    });
    expect(decideDataRelation(brand("UserId", "String"), prim("String"))).toEqual({
      verdict: "check",
      actual: "String",
      expected: "String",
    });
    expect(decideDataRelation(brand("Count", "Int"), prim("Float"))).toEqual({
      verdict: "check",
      actual: "Int",
      expected: "Float",
    });
  });

  test("Option is covariant and rejects non-Option values", () => {
    expect(decideDataRelation(option("Int"), option("Float"))).toEqual({
      verdict: "check",
      actual: "Int",
      expected: "Float",
    });
    expect(decideDataRelation(prim("String"), option("String"))).toEqual({ verdict: "reject" });
    expect(decideDataRelation(option("String"), prim("String"))).toEqual({ verdict: "reject" });
  });

  test("Unknown and Never follow gradual and bottom-type rules; non-data nodes defer", () => {
    expect(decideDataRelation(unknownNode, prim("Int"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(prim("Int"), unknownNode)).toEqual({ verdict: "accept" });
    expect(decideDataRelation(neverNode, prim("Int"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(neverNode, brand("UserId", "String"))).toEqual({ verdict: "accept" });
    expect(decideDataRelation(prim("Int"), neverNode)).toEqual({ verdict: "reject" });
    expect(decideDataRelation(other("RecordA"), other("RecordB"))).toEqual({ verdict: "defer" });
    expect(decideDataRelation(other("RecordA"), prim("Int"))).toEqual({ verdict: "reject" });
  });
});
