import { describe, expect, test } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";

const contractIds = (prelude: string, source: string) => {
  const result = elaborateProgram(source, { prelude: bootstrapFromSources("", prelude) });
  expect(result.diagnostics).toEqual([]);
  return result.declarations.map(
    (declaration) => [declaration.payloadContract, declaration.payloadContractId] as const,
  );
};

const types = `(type StepIR {:kind "Step" :name String :retries Int})
  (type FlowIR {:kind "Flow" :steps (List StepIR)})`;
const twoSurfaces = `${types}
  (form (flow step ...) :types {:step (List String)} :ir FlowIR
    {:kind "Flow" :steps (map (fn [n] {:kind "Step" :name n :retries 0}) step)})
  (form (process step ...) :types {:step (List String)} :ir FlowIR
    {:kind "Flow" :steps (map (fn [n] {:kind "Step" :name n :retries 1}) step)})`;

describe("payload contract identity", () => {
  test("forms with different syntax that produce one IR type share its identity", () => {
    const [[flowContract, flowId] = [], [processContract, processId] = []] = contractIds(
      twoSurfaces,
      '(flow "a") (process "b")',
    );
    expect(flowContract).toBe("FlowIR");
    expect(processContract).toBe("FlowIR");
    expect(flowId).toMatch(/^[a-f0-9]{64}$/);
    expect(processId).toBe(flowId);
  });

  test("ignores layout and record field order but not reachable definitions", () => {
    const prelude = twoSurfaces;
    const [[, id] = []] = contractIds(prelude, '(flow "a")');
    const reordered = prelude.replace('{:kind "Step" :name String :retries Int}', '{ :retries Int\n  :name String :kind "Step" }');
    expect(contractIds(reordered, '(flow "a")')[0]![1]).toBe(id);
    const changed = prelude.replace(":retries Int}", ":retries (Int :min 0)}");
    expect(contractIds(changed, '(flow "a")')[0]![1]).not.toBe(id);
    const unrelated = `${prelude} (type OtherIR {:kind "Other"})`;
    expect(contractIds(unrelated, '(flow "a")')[0]![1]).toBe(id);
  });
});
