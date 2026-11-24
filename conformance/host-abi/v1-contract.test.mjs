import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(new URL("./v1-contract.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("./schema.json", import.meta.url), "utf8"));

test("host ABI schema satisfies v1 contract snapshot", () => {
  assert.equal(schema.abiVersion, contract.hostAbiVersion);
  const actualOps = Object.keys(schema.responses);
  for (const op of contract.requiredOperations) {
    assert.ok(actualOps.includes(op), `Missing required ABI operation: ${op}`);
  }
  const requestDefs = Object.keys(schema.requests.definitions ?? {});
  for (const def of contract.journalDefinitions) {
    assert.ok(requestDefs.includes(def), `Missing journal schema definition: ${def}`);
  }
  const serializedRequests = JSON.stringify(schema.requests);
  assert.ok(serializedRequests.includes(contract.journalFormat), `Missing journal format literal ${contract.journalFormat}`);
  for (const limitField of contract.checkedRunLimits) {
    assert.ok(serializedRequests.includes(`"${limitField}"`), `Missing checkedRun limit field: ${limitField}`);
  }
});
