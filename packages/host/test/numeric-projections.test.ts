import { expect, it } from "vitest";
import { TsLanguageHost, NodeOcamlLanguageHost, type LanguageHost } from "../src/index.js";
import { JsonAbi } from "../src/json-abi.js";

it("matches live OCaml numeric tags and printing at the host boundary", async () => {
  const hosts: LanguageHost[] = [new TsLanguageHost()];
  const native = new NodeOcamlLanguageHost();
  if (await native.available()) hosts.push(native);
  for (const host of hosts) {
    const result = await host.evaluate({ source: "[2 2.0 (* 2.0 3) (/ 6 3) (floor 2.0)]" });
    expect(result.value).toMatchObject({ kind: "list", items: [
      {kind: "int", value: 2}, {kind: "float", value: 2}, {kind: "float", value: 6},
      {kind: "float", value: 2}, {kind: "int", value: 2},
    ] });
    const scalar = await host.evaluate({source: "(* 2.0 3)"});
    expect(await host.projectValue({value: scalar.value, projections: ["printed"]})).toMatchObject({printed: "6.0"});
  }
});

it("preserves explicit Float variables, retained values, and host call results", async () => {
  const host = new TsLanguageHost();
  const {sessionId} = await host.openSession({});
  try {
    await host.configureSession({sessionId, variables: [{name: "x", value: {kind: "float", value: 2}}]});
    const evaluated = await host.evaluateInSession({sessionId, source: "(* x 3)", retainValues: "all"});
    expect(evaluated).toMatchObject({status: "completed", result: { value: {kind: "float", value: 6}, printed: "6.0" }});
    if (evaluated.status !== "completed" || !evaluated.result.value.valueRef) throw new Error("missing retained value");
    expect(await host.projectValue({sessionId, valueRef: evaluated.result.value.valueRef, projections: ["printed", "plain-json", "summary"]})).toMatchObject({printed: "6.0", plainJson: 6});
    await host.configureSession({sessionId, hostBuiltins: [{name: "external", arity: 1, handler: {kind: "host-effect", effect: "test/numeric"}}]});
    const pending = await host.evaluateInSession({sessionId, source: "(* (external 2.0) 3)"});
    expect(pending).toMatchObject({status: "host-call", call: {args: [{kind: "float", value: 2}]}});
    if (pending.status !== "host-call") throw new Error("missing host call");
    expect(await host.resumeHostCall({sessionId, evaluationId: pending.call.evaluationId, callId: pending.call.callId, result: {ok: true, value: {kind: "float", value: 2}}})).toMatchObject({status: "completed", result: {value: {kind: "float", value: 6}}});
  } finally { await host.closeSession({sessionId}); }
});

it("serializes nonfinite Floats as explicit ABI values and plain JSON null", async () => {
  const abi = new JsonAbi();
  for (const [source, value] of [["(/ 0 0)", "NaN"], ["(/ 1 0)", "Infinity"], ["(/ -1 0)", "-Infinity"]]) {
    const response = JSON.parse(JSON.stringify(await abi.handleJson(JSON.stringify({op: "evaluate", source}))));
    expect(response).toMatchObject({ok: true, value: {kind: "float", value}});
    const projected = JSON.parse(JSON.stringify(await abi.handleJson(JSON.stringify({op: "projectValue", value: {kind: "float", value}, projections: ["plain-json", "printed"]}))));
    expect(projected).toMatchObject({ok: true, value: {plainJson: null, printed: value}});
  }
});

it("preserves signed zero across ABI serialization", async () => {
  const abi = new JsonAbi();
  const response = JSON.parse(JSON.stringify(await abi.handleJson(JSON.stringify({op: "evaluate", source: "-0.0"}))));
  expect(response).toMatchObject({ok: true, value: {kind: "float", value: "-0"}});
  expect(await abi.handleJson(JSON.stringify({op: "projectValue", value: response.value, projections: ["printed", "plain-json"]}))).toMatchObject({ok: true, value: {printed: "-0.0", plainJson: -0}});
});
