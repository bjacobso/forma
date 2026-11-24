import assert from "node:assert/strict";
import test from "node:test";
import { JOURNAL_FORMAT, parseJournalJsonl } from "@forma-language/forma";
import { openPolicyLanguage, runInWorker, SAMPLE_PROGRAM } from "./index.mjs";

test("loads domain prelude and module, describes vocabulary, and validates IR", async () => {
  const lang = await openPolicyLanguage();
  try {
    const description = lang.describe();
    assert.ok(description.forms.some(form => form.name === "playbook"));

    const validIr = await lang.emit('(playbook checkout-latency "sev1" "Escalate checkout latency spike")');
    assert.equal(validIr.ok, true);

    const invalidIr = await lang.emit('(playbook checkout-latency "sev9" "Bad severity")');
    assert.equal(invalidIr.ok, false);
    assert.ok(invalidIr.diagnostics.some(d => d.code === "playbook/invalid-severity"));
  } finally {
    await lang.close();
  }
});

test("checks an agent-authored program and inspects its CapabilityManifest", async () => {
  const lang = await openPolicyLanguage();
  try {
    const program = [
      '(let [detail (fetch-incident "INC-404")]',
      '  (post-alert "ops-oncall" (format-alert "INC-404" "sev1" detail))',
      '  detail)',
    ].join("\n");
    const checked = await lang.check(program, { sourceId: "triage.lisp" });
    assert.equal(checked.ok, true);
    assert.ok(checked.manifest.sources.length >= 1);
    assert.match(checked.manifest.sources[0].sha256, /^[a-f0-9]{64}$/);
    assert.ok(checked.manifest.preludes.length >= 1);
    assert.match(checked.manifest.preludes[0].sha256, /^[a-f0-9]{64}$/);

    const caps = new Map(checked.manifest.capabilities.map(c => [c.name, c]));
    assert.deepEqual([...caps.keys()].sort(), ["fetch-incident", "post-alert"]);
    assert.equal(caps.get("fetch-incident").purity, "read");
    assert.equal(caps.get("post-alert").purity, "write");
    assert.match(caps.get("fetch-incident").signature, /String/);
  } finally {
    await lang.close();
  }
});

test("rejects an ungranted capability before running with zero live host calls", async () => {
  const program = [
    '(fetch-incident "INC-404")',
    '(delete-cluster "us-east-1")',
  ].join("\n");

  const response = await runInWorker({
    action: "run",
    source: program,
    grants: [
      { name: "fetch-incident", mode: "allow" },
      { name: "post-alert", mode: "allow" },
    ],
  });

  assert.equal(response.ok, true);
  assert.equal(response.liveHostCalls, 0);
  assert.equal(response.state.status, "rejected");
  assert.equal(response.state.stage, "grant");
  assert.ok(response.state.requires.includes("delete-cluster"));
  assert.ok(response.state.manifest.capabilities.some(c => c.name === "delete-cluster"));
});

test("runs in worker_threads under budgets with onHostCall span inspection and policy denial", async () => {
  const accepted = await runInWorker({
    action: "run",
    source: SAMPLE_PROGRAM,
    limits: { steps: 50_000, timeoutMs: 2_000, hostCalls: 4 },
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.status, "completed");
  assert.equal(accepted.liveHostCalls, 2);
  assert.equal(accepted.state.hostCalls, 2);
  assert.equal(accepted.state.result.value.value, "checkout-api latency > 2s in us-east-1");
  assert.equal(accepted.auditLog.length, 2);
  assert.equal(accepted.auditLog[0].name, "fetch-incident");
  assert.equal(accepted.auditLog[0].decision, "allow");
  assert.ok(accepted.auditLog[0].span && accepted.auditLog[0].span.endOffset > accepted.auditLog[0].span.startOffset);
  assert.equal(accepted.auditLog[0].span.startLine, 1);
  assert.equal(accepted.auditLog[0].snippet, '(fetch-incident "INC-404")');
  assert.equal(accepted.auditLog[1].name, "post-alert");
  assert.equal(accepted.auditLog[1].decision, "allow");

  // onHostCall denies a protected channel and preserves the author span.
  const deniedProgram = '(post-alert "prod-root" "unauthorized broadcast")';
  const denied = await runInWorker({
    action: "run",
    source: deniedProgram,
    limits: { steps: 50_000, timeoutMs: 2_000, hostCalls: 4 },
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.liveHostCalls, 0);
  assert.equal(denied.state.status, "failed");
  assert.equal(denied.auditLog[0].decision, "deny");
  assert.equal(denied.auditLog[0].snippet, deniedProgram);
  assert.ok(denied.state.diagnostics.some(d => d.code === "capability/denied" && d.span));

  // Explicit hostCalls budget stops a program exceeding its allowance.
  const overBudget = await runInWorker({
    action: "run",
    source: SAMPLE_PROGRAM,
    limits: { steps: 50_000, timeoutMs: 2_000, hostCalls: 1 },
  });
  assert.equal(overBudget.ok, true);
  assert.equal(overBudget.state.status, "failed");
  assert.equal(overBudget.liveHostCalls, 1);
  assert.ok(overBudget.state.diagnostics.some(d => d.code === "limit/host-calls"));
});

test("records forma-journal/v1, replays with zero live host calls, and catches mutation divergence", async () => {
  const live = await runInWorker({
    action: "run",
    source: SAMPLE_PROGRAM,
    journalMode: "record",
  });
  assert.equal(live.ok, true);
  assert.equal(live.state.status, "completed");
  assert.equal(live.liveHostCalls, 2);
  assert.equal(typeof live.journalJsonl, "string");

  const parsed = parseJournalJsonl(live.journalJsonl);
  assert.equal(parsed.header.format, JOURNAL_FORMAT);
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries.map(e => e.name), ["fetch-incident", "post-alert"]);

  // Deterministic replay executes with zero live host calls and matches the live value.
  const replay = await runInWorker({
    action: "run",
    source: SAMPLE_PROGRAM,
    journalMode: "replay",
    journalJsonl: live.journalJsonl,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.state.status, "completed");
  assert.equal(replay.liveHostCalls, 0);
  assert.deepEqual(replay.state.result.value, live.state.result.value);

  // Mutating the program without allowProgramMismatch fails digest verification.
  const mutated = SAMPLE_PROGRAM.replace('"INC-404"', '"INC-500"');
  const mismatch = await runInWorker({
    action: "run",
    source: mutated,
    journalMode: "replay",
    journalJsonl: live.journalJsonl,
  });
  assert.equal(mismatch.ok, true);
  assert.equal(mismatch.liveHostCalls, 0);
  assert.equal(mismatch.state.status, "failed");
  assert.ok(mismatch.state.diagnostics.some(d => d.code === "journal/program-mismatch"));

  // Allowing program mismatch proceeds to the mutated call and fails with journal/diverged.
  const diverged = await runInWorker({
    action: "run",
    source: mutated,
    journalMode: "replay",
    journalJsonl: live.journalJsonl,
    allowProgramMismatch: true,
  });
  assert.equal(diverged.ok, true);
  assert.equal(diverged.liveHostCalls, 0);
  assert.equal(diverged.state.status, "failed");
  assert.ok(diverged.state.diagnostics.some(d => d.code === "journal/diverged"));
});
