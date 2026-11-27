import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AnalysisWorkspace } from "../../src/analysis/workspace.js";
import { emit } from "../../src/artifact/emit.js";
import { generateEffectProgram } from "../../src/mechanics/elaborate.js";
import { LanguageSession } from "../../src/session/session.js";
import {
  EVIDENCE_FORMAT_VERSION,
  EvidenceCache,
  EvidenceCacheRejectionError,
  cachedArtifact,
  cachedTypecheck,
  checkEvidenceCacheability,
  hashEvidenceKey,
  type EvidenceKey,
  type EvidenceRecord,
  type TestEvidencePayload,
  type TypecheckEvidencePayload,
  type VerificationEvidencePayload,
} from "../../src/store/evidence-cache.js";
import {
  computeInputDigest,
  computePreludeDigest,
  computeToolchainDigest,
  defaultArtifactToolchain,
  defaultTypecheckToolchain,
} from "../../src/store/toolchain-digest.js";
import { FileEvidenceBackend, openNodeEvidenceCache } from "../../src/node/evidence-store.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forma-evidence-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("toolchainDigest and inputDigest", () => {
  test("computes deterministic toolchainDigest and invalidates on any component change", () => {
    const base = computeToolchainDigest({
      checkerVersion: "0.3.0",
      emitterVersion: "0.3.0",
      languageProfile: "forma-core-v1",
      preludes: {
        "kernel.lisp": "(define id (fn [x] x))",
        "domain.lisp": "(type UserId String)",
      },
      flags: { strict: true, target: "effect-ts" },
    });

    // Record key order and Map vs Record produce the exact same digest.
    const reorderedRecord = computeToolchainDigest({
      checkerVersion: "0.3.0",
      emitterVersion: "0.3.0",
      languageProfile: "forma-core-v1",
      preludes: {
        "domain.lisp": "(type UserId String)",
        "kernel.lisp": "(define id (fn [x] x))",
      },
      flags: { target: "effect-ts", strict: true },
    });
    const asMap = computeToolchainDigest({
      checkerVersion: "0.3.0",
      emitterVersion: "0.3.0",
      languageProfile: "forma-core-v1",
      preludes: new Map([
        ["domain.lisp", computePreludeDigest("(type UserId String)")],
        ["kernel.lisp", computePreludeDigest("(define id (fn [x] x))")],
      ]),
      flags: { strict: true, target: "effect-ts" },
    });

    expect(base).toMatch(/^toolchain:v1:[0-9a-f]{64}$/);
    expect(reorderedRecord).toBe(base);
    expect(asMap).toBe(base);

    // Every single component change invalidates the digest.
    expect(
      computeToolchainDigest({
        checkerVersion: "0.3.1",
        emitterVersion: "0.3.0",
        languageProfile: "forma-core-v1",
        preludes: {
          "kernel.lisp": "(define id (fn [x] x))",
          "domain.lisp": "(type UserId String)",
        },
        flags: { strict: true, target: "effect-ts" },
      }),
    ).not.toBe(base);

    expect(
      computeToolchainDigest({
        checkerVersion: "0.3.0",
        emitterVersion: "0.4.0",
        languageProfile: "forma-core-v1",
        preludes: {
          "kernel.lisp": "(define id (fn [x] x))",
          "domain.lisp": "(type UserId String)",
        },
        flags: { strict: true, target: "effect-ts" },
      }),
    ).not.toBe(base);

    expect(
      computeToolchainDigest({
        checkerVersion: "0.3.0",
        emitterVersion: "0.3.0",
        languageProfile: "forma-strict-v2",
        preludes: {
          "kernel.lisp": "(define id (fn [x] x))",
          "domain.lisp": "(type UserId String)",
        },
        flags: { strict: true, target: "effect-ts" },
      }),
    ).not.toBe(base);

    expect(
      computeToolchainDigest({
        checkerVersion: "0.3.0",
        emitterVersion: "0.3.0",
        languageProfile: "forma-core-v1",
        preludes: {
          "kernel.lisp": "(define id (fn [x] x))",
          "domain.lisp": "(type UserId Int)",
        },
        flags: { strict: true, target: "effect-ts" },
      }),
    ).not.toBe(base);
  });

  test("ordered prelude arrays preserve load-order sensitivity", () => {
    const ab = computeToolchainDigest({
      preludes: [
        { id: "a.lisp", source: "(define a 1)" },
        { id: "b.lisp", source: "(define b 2)" },
      ],
    });
    const ba = computeToolchainDigest({
      preludes: [
        { id: "b.lisp", source: "(define b 2)" },
        { id: "a.lisp", source: "(define a 1)" },
      ],
    });
    expect(ab).not.toBe(ba);
  });

  test("inputDigest is key-order invariant and sensitive to values", () => {
    const d1 = computeInputDigest({ target: "esnext", comments: false });
    const d2 = computeInputDigest({ comments: false, target: "esnext" });
    const d3 = computeInputDigest({ target: "esnext", comments: true });
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
  });
});

describe("RFC 0029 Stage 1 evidence cache: typecheck and artifact reuse", () => {
  const sampleSource = `(define add-one (fn [x] (+ x 1)))\n(add-one 41)`;
  const effectSource = [
    `(service Users (: find (Effect Int)))`,
    `(: load-user (Effect Int [] [Users]))`,
    `(define load-user (do! [id Users.find] (succeed id)))`,
  ].join("\n");

  function runRealTypecheck(source: string): TypecheckEvidencePayload {
    const workspace = new AnalysisWorkspace();
    workspace.setDocument("main.lisp", source);
    const analysis = workspace.analysis("main.lisp");
    return {
      ok: analysis.diagnostics.every((d) => d.severity !== "error"),
      signature: analysis.resultType,
      requirements: [],
      errors: [],
      diagnostics: analysis.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        severity: d.severity,
      })),
    };
  }

  function runRealCanonicalIrEmit(source: string): string {
    const session = new LanguageSession({ id: "evidence-cache-test" });
    session.rememberSource({ id: "main.lisp", text: source });
    const result = emit({ session, sourceId: "main.lisp" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected emit to succeed");
    return JSON.stringify(result.artifacts);
  }

  function runRealEffectTsEmit(source: string): string {
    const result = generateEffectProgram(source, { sourceId: "effect.lisp" });
    expect(result.ok).toBe(true);
    expect(result.code).toBeDefined();
    return result.code!;
  }

  test("zero re-checking and zero re-emission across fresh persistent store instances", () => {
    const projectRoot = makeTempDir();
    const defHash = "def:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const effectDefHash = "def:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const tcDigest = defaultTypecheckToolchain();
    const irDigest = defaultArtifactToolchain("canonical-ir");
    const tsDigest = defaultArtifactToolchain("effect-ts");

    let typecheckRuns = 0;
    let irEmitRuns = 0;
    let tsEmitRuns = 0;

    // First store instance (cold): runs real typechecker and emitters once.
    const cold = openNodeEvidenceCache({ rootDir: projectRoot });
    cold.backend.putDefinitionObject(defHash, {
      hash: defHash,
      kind: "define",
      name: "add-one",
    });

    const tc1 = cachedTypecheck(cold.cache, {
      defHash,
      toolchainDigest: tcDigest,
      compute: () => {
        typecheckRuns++;
        return runRealTypecheck(sampleSource);
      },
    });
    const ir1 = cachedArtifact(cold.cache, {
      defHash: effectDefHash,
      format: "canonical-ir",
      toolchainDigest: irDigest,
      emit: () => {
        irEmitRuns++;
        return runRealCanonicalIrEmit(effectSource);
      },
    });
    const ts1 = cachedArtifact(cold.cache, {
      defHash: effectDefHash,
      format: "effect-ts",
      toolchainDigest: tsDigest,
      emit: () => {
        tsEmitRuns++;
        return runRealEffectTsEmit(effectSource);
      },
    });

    expect(tc1.hit).toBe(false);
    expect(tc1.cached).toBe(true);
    expect(tc1.record.formatVersion).toBe(EVIDENCE_FORMAT_VERSION);
    expect(tc1.record.payload.ok).toBe(true);
    expect(tc1.record.payload.signature).toBe("Int");
    expect(tc1.record.trust.producer).toBe("forma-hm-effect-checker");
    expect(tc1.record.trust.deterministic).toBe(true);

    expect(ir1.hit).toBe(false);
    expect(ir1.record.payload.format).toBe("canonical-ir");
    expect(ts1.hit).toBe(false);
    expect(ts1.record.payload.format).toBe("effect-ts");
    expect(ts1.record.payload.content).toContain("Users");

    expect(typecheckRuns).toBe(1);
    expect(irEmitRuns).toBe(1);
    expect(tsEmitRuns).toBe(1);

    // Fresh store instance pointing at the same `.forma/store/` directory:
    // proves zero re-checking and zero re-emission.
    const warm = openNodeEvidenceCache({ rootDir: projectRoot });
    expect(warm.backend.getDefinitionObject(defHash)).toEqual({
      hash: defHash,
      kind: "define",
      name: "add-one",
    });

    const tc2 = cachedTypecheck(warm.cache, {
      defHash,
      toolchainDigest: tcDigest,
      compute: () => {
        typecheckRuns++;
        throw new Error("Should not re-typecheck unchanged definition");
      },
    });
    const ir2 = cachedArtifact(warm.cache, {
      defHash: effectDefHash,
      format: "canonical-ir",
      toolchainDigest: irDigest,
      emit: () => {
        irEmitRuns++;
        throw new Error("Should not re-emit unchanged canonical IR");
      },
    });
    const ts2 = cachedArtifact(warm.cache, {
      defHash: effectDefHash,
      format: "effect-ts",
      toolchainDigest: tsDigest,
      emit: () => {
        tsEmitRuns++;
        throw new Error("Should not re-emit unchanged Effect TypeScript");
      },
    });

    expect(tc2.hit).toBe(true);
    expect(tc2.record.payload).toEqual(tc1.record.payload);
    expect(tc2.record.trust).toEqual(tc1.record.trust);

    expect(ir2.hit).toBe(true);
    expect(ir2.record.payload).toEqual(ir1.record.payload);

    expect(ts2.hit).toBe(true);
    expect(ts2.record.payload).toEqual(ts1.record.payload);

    expect(typecheckRuns).toBe(1);
    expect(irEmitRuns).toBe(1);
    expect(tsEmitRuns).toBe(1);

    const summary = warm.cache.summary(effectDefHash);
    expect(summary.defHash).toBe(effectDefHash);
    expect(summary.kinds).toEqual(["artifact"]);
    expect(summary.records).toHaveLength(2);
  });

  test("cross-process reuse reads persisted evidence from .forma/store without recomputation", () => {
    const projectRoot = makeTempDir();
    const defHash = "def:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const tcDigest = computeToolchainDigest({ checkerVersion: "0.3.0", languageProfile: "forma-core-v1" });
    const inputDigest = computeInputDigest();

    const { cache, backend } = openNodeEvidenceCache({ rootDir: projectRoot });
    const key: EvidenceKey = {
      defHash,
      kind: "typecheck",
      toolchainDigest: tcDigest,
      inputDigest,
    };
    const keyHash = hashEvidenceKey(key);

    cache.set<TypecheckEvidencePayload>({
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key,
      trust: {
        producer: "forma-hm-effect-checker",
        version: "0.3.0",
        profile: "forma-core-v1",
        deterministic: true,
      },
      payload: {
        ok: true,
        signature: "(-> Int Int)",
        requirements: [],
        errors: [],
        diagnostics: [],
      },
      createdAt: "2026-11-27T00:00:00.000Z",
    });

    // Spawn a separate Node process reading directly from the persisted .forma/store directory.
    const filePath = join(backend.storeDir, "evidence", "v1", keyHash.slice(0, 2), `${keyHash}.json`);
    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readFileSync } from "node:fs";
         const envelope = JSON.parse(readFileSync(process.argv[1], "utf8"));
         console.log(JSON.stringify({
           formatVersion: envelope.formatVersion,
           defHash: envelope.record.key.defHash,
           signature: envelope.record.payload.signature,
           producer: envelope.record.trust.producer,
         }));`,
        filePath,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(stdout)).toEqual({
      formatVersion: "forma-evidence-object/v1",
      defHash,
      signature: "(-> Int Int)",
      producer: "forma-hm-effect-checker",
    });
  });

  test("corrupted evidence files on disk are treated as cache misses", () => {
    const storeDir = join(makeTempDir(), ".forma", "store");
    const backend = new FileEvidenceBackend(storeDir);
    const cache = new EvidenceCache(backend);
    const key: EvidenceKey = {
      defHash: "def:v1:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      kind: "typecheck",
      toolchainDigest: defaultTypecheckToolchain(),
      inputDigest: computeInputDigest(),
    };
    cache.set<TypecheckEvidencePayload>({
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key,
      trust: {
        producer: "forma-hm-effect-checker",
        version: "0.3.0",
        profile: "forma-core-v1",
        deterministic: true,
      },
      payload: { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] },
    });

    // Tamper with stored payload without updating checksum.
    const keyHash = hashEvidenceKey(key);
    const filePath = join(storeDir, "evidence", "v1", keyHash.slice(0, 2), `${keyHash}.json`);
    const tampered = readFileSync(filePath, "utf8").replace('"Int"', '"String"');
    writeFileSync(filePath, tampered, "utf8");

    expect(cache.get(key)).toBeUndefined();
  });
});

describe("invalidation on toolchainDigest and inputDigest changes", () => {
  test("invalidates completely when toolchainDigest or inputDigest changes", () => {
    const cache = new EvidenceCache();
    const defHash = "def:v1:1111111111111111111111111111111111111111111111111111111111111111";
    const toolchainV1 = computeToolchainDigest({ checkerVersion: "0.3.0" });
    const toolchainV2 = computeToolchainDigest({ checkerVersion: "0.4.0" });
    const preludeV2 = computeToolchainDigest({
      checkerVersion: "0.3.0",
      preludes: { "kernel.lisp": "(define updated 1)" },
    });

    let computeCount = 0;

    // Initial miss under toolchainV1 + input A.
    const r1 = cachedTypecheck(cache, {
      defHash,
      toolchainDigest: toolchainV1,
      input: { mode: "a" },
      compute: () => {
        computeCount++;
        return { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] };
      },
    });
    expect(r1.hit).toBe(false);
    expect(computeCount).toBe(1);

    // Same toolchainDigest + same input -> hit.
    const r2 = cachedTypecheck(cache, {
      defHash,
      toolchainDigest: toolchainV1,
      input: { mode: "a" },
      compute: () => {
        computeCount++;
        return { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] };
      },
    });
    expect(r2.hit).toBe(true);
    expect(computeCount).toBe(1);

    // Checker version upgrade -> miss.
    const r3 = cachedTypecheck(cache, {
      defHash,
      toolchainDigest: toolchainV2,
      input: { mode: "a" },
      compute: () => {
        computeCount++;
        return { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] };
      },
    });
    expect(r3.hit).toBe(false);
    expect(computeCount).toBe(2);

    // Prelude digest change -> miss.
    const r4 = cachedTypecheck(cache, {
      defHash,
      toolchainDigest: preludeV2,
      input: { mode: "a" },
      compute: () => {
        computeCount++;
        return { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] };
      },
    });
    expect(r4.hit).toBe(false);
    expect(computeCount).toBe(3);

    // inputDigest change under toolchainV1 -> miss.
    const r5 = cachedTypecheck(cache, {
      defHash,
      toolchainDigest: toolchainV1,
      input: { mode: "b" },
      compute: () => {
        computeCount++;
        return { ok: true, signature: "Int", requirements: [], errors: [], diagnostics: [] };
      },
    });
    expect(r5.hit).toBe(false);
    expect(computeCount).toBe(4);
  });
});

describe("RFC 0029 §3 trust-account and test cacheability guards", () => {
  const baseKey: EvidenceKey = {
    defHash: "def:v1:2222222222222222222222222222222222222222222222222222222222222222",
    kind: "test",
    toolchainDigest: computeToolchainDigest({ checkerVersion: "0.3.0" }),
    inputDigest: computeInputDigest({ runner: "local-pure" }),
  };

  test("rejects caching test evidence with non-empty requirements", () => {
    const cache = new EvidenceCache();
    const record: EvidenceRecord<TestEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: baseKey,
      trust: {
        producer: "forma-test-runner",
        version: "0.3.0",
        profile: "local-pure-v1",
        deterministic: true,
      },
      payload: {
        passed: true,
        requirements: ["Http.get", "Clock"],
        runnerProfile: "local-pure-v1",
        deterministicRunner: true,
      },
    };

    expect(checkEvidenceCacheability(record)).toMatchObject({
      cacheable: false,
      reason: "non-empty-test-requirements",
    });

    expect(() => cache.set(record)).toThrow(EvidenceCacheRejectionError);
    expect(cache.putIfCacheable(record)).toMatchObject({
      stored: false,
      reason: "non-empty-test-requirements",
    });
    expect(cache.has(baseKey)).toBe(false);

    // getOrCompute runs the test but refuses to cache the result.
    let runs = 0;
    const first = cache.getOrCompute<TestEvidencePayload>(baseKey, () => {
      runs++;
      return { payload: record.payload, trust: record.trust };
    });
    const second = cache.getOrCompute<TestEvidencePayload>(baseKey, () => {
      runs++;
      return { payload: record.payload, trust: record.trust };
    });
    expect(first.cached).toBe(false);
    expect(first.rejectionReason).toBe("non-empty-test-requirements");
    expect(second.hit).toBe(false);
    expect(runs).toBe(2);
  });

  test("rejects caching test evidence with non-deterministic runner or trust account", () => {
    const cache = new EvidenceCache();

    const nonDetRunner: EvidenceRecord<TestEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: baseKey,
      trust: {
        producer: "forma-test-runner",
        version: "0.3.0",
        profile: "live-io",
        deterministic: true,
      },
      payload: {
        passed: true,
        requirements: [],
        runnerProfile: "live-io",
        deterministicRunner: false,
      },
    };
    expect(() => cache.set(nonDetRunner)).toThrow(EvidenceCacheRejectionError);
    expect(checkEvidenceCacheability(nonDetRunner)).toMatchObject({
      cacheable: false,
      reason: "non-deterministic-test-runner",
    });

    const nonDetTrust: EvidenceRecord<TestEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: baseKey,
      trust: {
        producer: "forma-test-runner",
        version: "0.3.0",
        profile: "live-io",
        deterministic: false,
      },
      payload: {
        passed: true,
        requirements: [],
        runnerProfile: "live-io",
        deterministicRunner: true,
      },
    };
    expect(() => cache.set(nonDetTrust)).toThrow(EvidenceCacheRejectionError);
    expect(checkEvidenceCacheability(nonDetTrust)).toMatchObject({
      cacheable: false,
      reason: "non-deterministic-test-runner",
    });

    const missingProfile: EvidenceRecord<TestEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: baseKey,
      trust: {
        producer: "forma-test-runner",
        version: "0.3.0",
        profile: "pure-v1",
        deterministic: true,
      },
      payload: {
        passed: true,
        requirements: [],
        runnerProfile: "   ",
        deterministicRunner: true,
      },
    };
    expect(checkEvidenceCacheability(missingProfile)).toMatchObject({
      cacheable: false,
      reason: "missing-runner-profile",
    });
  });

  test("accepts caching pure deterministic test evidence with empty requirements", () => {
    const cache = new EvidenceCache();
    const record: EvidenceRecord<TestEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: baseKey,
      trust: {
        producer: "forma-test-runner",
        version: "0.3.0",
        profile: "pure-local-v1",
        deterministic: true,
      },
      payload: {
        passed: true,
        requirements: [],
        runnerProfile: "pure-local-v1",
        deterministicRunner: true,
        summary: "all assertions passed",
      },
    };

    expect(checkEvidenceCacheability(record)).toEqual({ cacheable: true });
    cache.set(record);
    expect(cache.get<TestEvidencePayload>(baseKey)).toEqual(record);
  });

  test("enforces explicit bounds on verification evidence and complete trust accounts", () => {
    const cache = new EvidenceCache();
    const verKey: EvidenceKey = {
      ...baseKey,
      kind: "verification",
    };

    const unbounded: EvidenceRecord<VerificationEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: verKey,
      trust: {
        producer: "forma-bounded-verifier",
        version: "0.3.0",
        profile: "finite-model-v1",
        deterministic: true,
      },
      payload: {
        result: "holds-in-model",
        bounds: {},
        assumptions: ["finite-domain"],
      },
    };
    expect(checkEvidenceCacheability(unbounded)).toMatchObject({
      cacheable: false,
      reason: "verification-missing-bounds",
    });
    expect(() => cache.set(unbounded)).toThrow(EvidenceCacheRejectionError);

    const bounded: EvidenceRecord<VerificationEvidencePayload> = {
      ...unbounded,
      payload: {
        result: "holds-in-model",
        bounds: { maxSteps: 16, maxActors: 3 },
        assumptions: ["finite-domain"],
      },
    };
    expect(checkEvidenceCacheability(bounded)).toEqual({ cacheable: true });
    cache.set(bounded);
    expect(cache.get<VerificationEvidencePayload>(verKey)).toEqual(bounded);

    const missingTrust: EvidenceRecord<TypecheckEvidencePayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key: { ...baseKey, kind: "typecheck" },
      trust: {
        producer: "",
        version: "0.3.0",
        profile: "forma-core-v1",
        deterministic: true,
      },
      payload: { ok: true, requirements: [], errors: [], diagnostics: [] },
    };
    expect(checkEvidenceCacheability(missingTrust)).toMatchObject({
      cacheable: false,
      reason: "missing-trust-account",
    });
  });

  test("browser-safe store modules contain zero node:* imports", () => {
    const storeDir = resolve(import.meta.dirname, "../../src/store");
    for (const file of ["toolchain-digest.ts", "evidence-cache.ts"]) {
      const source = readFileSync(join(storeDir, file), "utf8");
      expect(source).not.toMatch(/from\s+["']node:/);
    }
  });
});
