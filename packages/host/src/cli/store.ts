import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, posix, relative, resolve, sep } from "node:path";
import {
  cachedTypecheck,
  defaultTypecheckToolchain,
  openNodeEvidenceCache,
  openNodeTransactionalStore,
  type EvidenceCache,
  type EvidenceCacheStats,
} from "@formalang/ts/node";
import {
  evaluateBranchPolicies,
  exportSnapshotToSources,
  importSourcesAsTransaction,
  type BranchPolicy,
  type OperationClass,
  type Snapshot,
  type SnapshotDiff,
  type TransactionResult,
} from "@formalang/ts/store-policies";
import {
  findDependencies,
  findDependents,
  getDefinition,
  queryByCapability,
  queryByError,
  type DefinitionDetails,
  type DefinitionIndexSource,
  type DefinitionRecord,
} from "@formalang/ts/store-queries";
import type { JsonResponse } from "../json-abi.js";
import { printJson } from "./output.js";

const DEFAULT_BRANCH = "main";
const IGNORED_DIRS = new Set([".forma", ".git", "node_modules", "dist"]);
const DEFAULT_INIT_POLICY: BranchPolicy = {
  protected: true,
  requirementEdit: {
    requireExplicitClass: true,
    requireApproval: true,
  },
};

type QueryKind = "def" | "dependents" | "dependencies" | "capability" | "error";

const QUERY_KINDS: readonly QueryKind[] = [
  "def",
  "dependents",
  "dependencies",
  "capability",
  "error",
];

function isFormaSourceFile(name: string): boolean {
  return name.endsWith(".lisp") || name.endsWith(".forma");
}

function toPosixPath(path: string): string {
  return path.split(sep).join(posix.sep);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectFilesInDir(dir: string, baseDir: string, out: DefinitionIndexSource[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    compareStrings(a.name, b.name),
  );
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectFilesInDir(resolve(dir, entry.name), baseDir, out);
    } else if (entry.isFile() && isFormaSourceFile(entry.name)) {
      const fullPath = resolve(dir, entry.name);
      const id = toPosixPath(relative(baseDir, fullPath));
      out.push({ id, source: readFileSync(fullPath, "utf8") });
    }
  }
}

function resolveFileModuleId(
  filePath: string,
  rootDir: string,
  existingModuleIds?: ReadonlySet<string>,
): string {
  const absFile = resolve(filePath);
  const absRoot = resolve(rootDir);
  const rel = relative(absRoot, absFile);
  if (rel && !rel.startsWith("..") && !rel.startsWith(sep)) {
    return toPosixPath(rel);
  }
  const normalized = toPosixPath(absFile);
  if (existingModuleIds) {
    let bestMatch: string | undefined;
    for (const moduleId of existingModuleIds) {
      if (normalized === moduleId || normalized.endsWith(`/${moduleId}`)) {
        if (!bestMatch || moduleId.length > bestMatch.length) {
          bestMatch = moduleId;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }
  return basename(absFile);
}

function collectSourcesFromInputs(
  inputs: readonly string[],
  rootDir: string,
  existingModuleIds?: ReadonlySet<string>,
): { readonly sources: readonly DefinitionIndexSource[]; readonly hasDirectoryInput: boolean } {
  const byId = new Map<string, string>();
  let hasDirectoryInput = false;

  if (inputs.length === 0) {
    hasDirectoryInput = true;
    const discovered: DefinitionIndexSource[] = [];
    collectFilesInDir(rootDir, rootDir, discovered);
    for (const src of discovered) byId.set(src.id, src.source);
  } else {
    for (const input of inputs) {
      const fullPath = resolve(input);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        hasDirectoryInput = true;
        const discovered: DefinitionIndexSource[] = [];
        collectFilesInDir(fullPath, fullPath, discovered);
        for (const src of discovered) byId.set(src.id, src.source);
      } else if (st.isFile()) {
        const id = resolveFileModuleId(fullPath, rootDir, existingModuleIds);
        byId.set(id, readFileSync(fullPath, "utf8"));
      }
    }
  }

  const sources = [...byId.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([id, source]) => ({ id, source }));
  return { sources, hasDirectoryInput };
}

function recordTypecheckEvidenceForRecords(
  cache: EvidenceCache,
  records: Iterable<DefinitionRecord>,
  languageProfile: string,
): number {
  const toolchainDigest = defaultTypecheckToolchain({ languageProfile });
  let recorded = 0;
  for (const record of records) {
    const res = cachedTypecheck(cache, {
      defHash: record.hash,
      toolchainDigest,
      compute: () => ({
        ok: true,
        ...(record.signature !== undefined ? { signature: record.signature } : {}),
        requirements: [...record.requirements],
        errors: [...record.errors],
        diagnostics: [],
      }),
    });
    if (res.cached) recorded++;
  }
  return recorded;
}

function emitResult(
  json: boolean,
  response: JsonResponse,
  formatHuman: () => string,
): void {
  if (json) {
    printJson(response);
  } else if (response.ok) {
    const text = formatHuman();
    if (text) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  } else {
    for (const diag of response.diagnostics) {
      process.stderr.write(`error [${diag.code}]: ${diag.message}\n`);
    }
  }
  if (!response.ok) process.exitCode = 1;
}

function errorResponse(code: string, message: string, value?: unknown): JsonResponse {
  return {
    ok: false,
    ...(value !== undefined ? { value } : {}),
    diagnostics: [{ code, severity: "error", message }],
  };
}

function openStore(rootDir: string) {
  const { cache: evidenceCache, backend: evidenceBackend } = openNodeEvidenceCache({ rootDir });
  const { store, backend: snapshotBackend } = openNodeTransactionalStore({
    rootDir,
    policyEvaluator: evaluateBranchPolicies,
    evidence: (hash) => evidenceCache.summary(hash),
  });
  return { store, snapshotBackend, evidenceCache, evidenceBackend };
}

function snapshotSummary(snapshot: Snapshot) {
  return {
    hash: snapshot.hash,
    parent: snapshot.parent,
    definitionCount: snapshot.bindings.size,
    policyHash: snapshot.policies,
    policyConfig: snapshot.policyConfig,
    languageProfile: snapshot.languageProfile,
    ...(snapshot.createdAt !== undefined ? { createdAt: snapshot.createdAt } : {}),
    ...(snapshot.message !== undefined ? { message: snapshot.message } : {}),
  };
}

function parseOptionValue(args: readonly string[], index: number): string | undefined {
  const next = args[index + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

function handleInit(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let branch = DEFAULT_BRANCH;
  let message: string | undefined;
  let json = false;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg === "--branch") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      branch = value;
      i++;
      continue;
    }
    if (arg === "--message") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      message = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) return false;
    files.push(arg);
  }

  const { store, snapshotBackend, evidenceCache } = openStore(rootDir);
  if (store.getBranch(branch)) {
    emitResult(
      json,
      errorResponse("store/branch-exists", `Branch '${branch}' already exists in ${snapshotBackend.storeDir}.`),
      () => "",
    );
    return true;
  }

  const { sources } = collectSourcesFromInputs(files, rootDir);
  const snapshot = store.createBranchFromSources(branch, sources, {
    policy: DEFAULT_INIT_POLICY,
    message: message ?? "Initial snapshot",
  });
  const index = store.getSnapshotIndex(snapshot.hash);
  if (index) {
    recordTypecheckEvidenceForRecords(evidenceCache, index.definitions.values(), snapshot.languageProfile);
  }
  const evidenceStats = evidenceCache.stats();

  const value = {
    branch,
    storeDir: snapshotBackend.storeDir,
    snapshot: snapshotSummary(snapshot),
    files: sources.map((s) => s.id),
    evidence: evidenceStats,
  };

  emitResult(
    json,
    { ok: true, value, diagnostics: [] },
    () =>
      [
        `Initialized store at ${snapshotBackend.storeDir}`,
        `Branch:      ${branch}`,
        `Snapshot:    ${snapshot.hash}`,
        `Definitions: ${snapshot.bindings.size} (from ${sources.length} file${sources.length === 1 ? "" : "s"})`,
        `Policy hash: ${snapshot.policies}`,
        `Evidence:    ${evidenceStats.entries} cached`,
      ].join("\n"),
  );
  return true;
}

function handleStatus(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let branch = DEFAULT_BRANCH;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg === "--branch") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      branch = value;
      i++;
      continue;
    }
    return false;
  }

  const { store, snapshotBackend, evidenceCache } = openStore(rootDir);
  const snapshot = store.getBranchSnapshot(branch);
  if (!snapshot) {
    emitResult(
      json,
      errorResponse("store/branch-not-found", `Branch '${branch}' not found in ${snapshotBackend.storeDir}.`),
      () => "",
    );
    return true;
  }

  const evidence: EvidenceCacheStats = evidenceCache.stats();
  const value = {
    branch,
    storeDir: snapshotBackend.storeDir,
    head: snapshot.hash,
    parent: snapshot.parent,
    definitionCount: snapshot.bindings.size,
    policyHash: snapshot.policies,
    policyConfig: snapshot.policyConfig,
    languageProfile: snapshot.languageProfile,
    evidence,
  };

  emitResult(
    json,
    { ok: true, value, diagnostics: [] },
    () =>
      [
        `Branch:      ${branch}`,
        `Head:        ${snapshot.hash}`,
        `Definitions: ${snapshot.bindings.size}`,
        `Policy hash: ${snapshot.policies}`,
        `Evidence:    ${evidence.entries} entries`,
      ].join("\n"),
  );
  return true;
}

function handleBranches(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    return false;
  }

  const { store, snapshotBackend } = openStore(rootDir);
  const branches = store.listBranches().map((ref) => {
    const snap = store.getSnapshot(ref.head);
    return {
      name: ref.name,
      head: ref.head,
      ...(ref.updatedAt !== undefined ? { updatedAt: ref.updatedAt } : {}),
      ...(snap !== undefined ? { definitionCount: snap.bindings.size } : {}),
    };
  });

  emitResult(
    json,
    { ok: true, value: { storeDir: snapshotBackend.storeDir, branches }, diagnostics: [] },
    () =>
      branches.length === 0
        ? "No branches."
        : branches.map((b) => `${b.name}  ${b.head}`).join("\n"),
  );
  return true;
}

function formatRecordLine(record: DefinitionRecord): string {
  const sig = record.signature ? ` : ${record.signature}` : "";
  return `${record.qualifiedName} [${record.kind}] ${record.hash}${sig}`;
}

function formatDefinitionDetails(def: DefinitionDetails): string {
  const lines = [
    `Name:         ${def.qualifiedName}`,
    `Kind:         ${def.kind}`,
    `Hash:         ${def.hash}`,
  ];
  if (def.signature) lines.push(`Signature:    ${def.signature}`);
  if (def.requirements.length > 0) lines.push(`Requirements: ${def.requirements.join(", ")}`);
  if (def.errors.length > 0) lines.push(`Errors:       ${def.errors.join(", ")}`);
  if (def.evidence && def.evidence.kinds.length > 0) {
    lines.push(`Evidence:     ${def.evidence.kinds.join(", ")}`);
  }
  if (def.authoredSource) {
    lines.push("", def.authoredSource);
  }
  return lines.join("\n");
}

function handleQuery(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let branch = DEFAULT_BRANCH;
  let transitive = false;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--transitive") { transitive = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg === "--branch") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      branch = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) return false;
    positional.push(arg);
  }

  if (positional.length !== 2) return false;
  const [kindRaw, target] = positional as [string, string];
  if (!QUERY_KINDS.includes(kindRaw as QueryKind)) return false;
  const kind = kindRaw as QueryKind;

  const { store, snapshotBackend, evidenceCache } = openStore(rootDir);
  const snapshot = store.getBranchSnapshot(branch);
  if (!snapshot) {
    emitResult(
      json,
      errorResponse("store/branch-not-found", `Branch '${branch}' not found in ${snapshotBackend.storeDir}.`),
      () => "",
    );
    return true;
  }

  const index = store.getSnapshotIndex(snapshot.hash);
  if (!index) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Snapshot '${snapshot.hash}' could not be indexed.`),
      () => "",
    );
    return true;
  }

  if (kind === "def") {
    const definition = getDefinition(index, target, {
      evidence: (hash) => evidenceCache.summary(hash),
    });
    if (!definition) {
      emitResult(
        json,
        errorResponse("store/definition-not-found", `Definition '${target}' not found on branch '${branch}'.`),
        () => "",
      );
      return true;
    }
    emitResult(
      json,
      {
        ok: true,
        value: { branch, snapshotHash: snapshot.hash, kind, target, definition },
        diagnostics: [],
      },
      () => formatDefinitionDetails(definition),
    );
    return true;
  }

  const definitions: readonly DefinitionRecord[] =
    kind === "dependents"
      ? findDependents(index, target, { transitive })
      : kind === "dependencies"
        ? findDependencies(index, target, { transitive })
        : kind === "capability"
          ? queryByCapability(index, target)
          : queryByError(index, target);

  emitResult(
    json,
    {
      ok: true,
      value: { branch, snapshotHash: snapshot.hash, kind, target, transitive, definitions },
      diagnostics: [],
    },
    () =>
      definitions.length === 0
        ? "No matching definitions."
        : definitions.map(formatRecordLine).join("\n"),
  );
  return true;
}

function formatDiff(diff: SnapshotDiff): string {
  const lines = [`From: ${diff.fromSnapshot}`, `To:   ${diff.toSnapshot}`];
  const changes: string[] = [];
  for (const a of diff.added) {
    changes.push(`+ ${a.qualifiedName} [${a.kind}] ${a.hash}`);
  }
  for (const r of diff.removed) {
    changes.push(`- ${r.qualifiedName} [${r.kind}] ${r.hash}`);
  }
  for (const u of diff.updated) {
    const tag = u.interfaceChanged ? " (interface changed)" : "";
    changes.push(`~ ${u.qualifiedName} [${u.kind}]${tag}`);
  }
  for (const rn of diff.renamed) {
    changes.push(`R ${rn.from} -> ${rn.to} ${rn.hash}`);
  }
  if (changes.length === 0) {
    lines.push("No differences.");
  } else {
    lines.push(...changes);
  }
  return lines.join("\n");
}

function handleDiff(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg.startsWith("-")) return false;
    positional.push(arg);
  }

  if (positional.length !== 2) return false;
  const [fromRef, toRef] = positional as [string, string];

  const { store } = openStore(rootDir);
  const resolveRef = (ref: string): string | undefined => {
    if (store.getSnapshot(ref)) return ref;
    return store.getBranch(ref)?.head;
  };

  const fromHash = resolveRef(fromRef);
  if (!fromHash) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Unknown snapshot or branch '${fromRef}'.`),
      () => "",
    );
    return true;
  }
  const toHash = resolveRef(toRef);
  if (!toHash) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Unknown snapshot or branch '${toRef}'.`),
      () => "",
    );
    return true;
  }

  const diff = store.diffSnapshots(fromHash, toHash);
  if (!diff) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Could not diff '${fromHash}' and '${toHash}'.`),
      () => "",
    );
    return true;
  }

  emitResult(
    json,
    { ok: true, value: { from: fromHash, to: toHash, diff }, diagnostics: [] },
    () => formatDiff(diff),
  );
  return true;
}

function handleExport(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let branch = DEFAULT_BRANCH;
  let outDir: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg === "--branch") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      branch = value;
      i++;
      continue;
    }
    if (arg === "--out") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      outDir = resolve(value);
      i++;
      continue;
    }
    return false;
  }

  if (!outDir) return false;

  const { store, snapshotBackend } = openStore(rootDir);
  const snapshot = store.getBranchSnapshot(branch);
  if (!snapshot) {
    emitResult(
      json,
      errorResponse("store/branch-not-found", `Branch '${branch}' not found in ${snapshotBackend.storeDir}.`),
      () => "",
    );
    return true;
  }

  const index = store.getSnapshotIndex(snapshot.hash);
  if (!index) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Snapshot '${snapshot.hash}' could not be indexed.`),
      () => "",
    );
    return true;
  }

  const projected = exportSnapshotToSources(snapshot, index);
  mkdirSync(outDir, { recursive: true });
  const absOut = resolve(outDir);
  const written: string[] = [];

  for (const mod of projected) {
    const targetPath = resolve(absOut, mod.id);
    if (targetPath !== absOut && !targetPath.startsWith(absOut + sep)) {
      emitResult(
        json,
        errorResponse("store/invalid-export-path", `Module path '${mod.id}' escapes output directory '${outDir}'.`),
        () => "",
      );
      return true;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, mod.source, "utf8");
    written.push(mod.id);
  }

  emitResult(
    json,
    {
      ok: true,
      value: { branch, snapshotHash: snapshot.hash, outDir: absOut, files: written },
      diagnostics: [],
    },
    () =>
      [
        `Exported ${written.length} file${written.length === 1 ? "" : "s"} from ${branch} (${snapshot.hash}) to ${absOut}`,
        ...written.map((f) => `  ${f}`),
      ].join("\n"),
  );
  return true;
}

function handleImport(args: readonly string[]): boolean {
  let rootDir = process.cwd();
  let branch = DEFAULT_BRANCH;
  let operationClass: OperationClass | undefined;
  let approveRequirementEdit = false;
  let message: string | undefined;
  let json = false;
  const inputs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--approve-requirement-edit") { approveRequirementEdit = true; continue; }
    if (arg === "--dir") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      rootDir = resolve(value);
      i++;
      continue;
    }
    if (arg === "--branch") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      branch = value;
      i++;
      continue;
    }
    if (arg === "--class") {
      const value = parseOptionValue(args, i);
      if (value !== "impl-edit" && value !== "requirement-edit") return false;
      operationClass = value;
      i++;
      continue;
    }
    if (arg === "--message") {
      const value = parseOptionValue(args, i);
      if (!value) return false;
      message = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) return false;
    inputs.push(arg);
  }

  if (inputs.length === 0) return false;

  for (const input of inputs) {
    if (!existsSync(resolve(input))) {
      emitResult(
        json,
        errorResponse("io/error", `Path does not exist: ${input}`),
        () => "",
      );
      return true;
    }
  }

  const { store, snapshotBackend, evidenceCache } = openStore(rootDir);
  const snapshot = store.getBranchSnapshot(branch);
  if (!snapshot) {
    emitResult(
      json,
      errorResponse("store/branch-not-found", `Branch '${branch}' not found in ${snapshotBackend.storeDir}.`),
      () => "",
    );
    return true;
  }

  const index = store.getSnapshotIndex(snapshot.hash);
  if (!index) {
    emitResult(
      json,
      errorResponse("store/snapshot-not-found", `Snapshot '${snapshot.hash}' could not be indexed.`),
      () => "",
    );
    return true;
  }

  const existingModuleIds = new Set<string>();
  for (const record of index.definitions.values()) {
    existingModuleIds.add(record.moduleId);
  }

  const { sources: importedSources, hasDirectoryInput } = collectSourcesFromInputs(
    inputs,
    rootDir,
    existingModuleIds,
  );

  let editedSources: readonly DefinitionIndexSource[] = importedSources;
  if (!hasDirectoryInput && existingModuleIds.size > 0) {
    const importedIds = new Set(importedSources.map((s) => s.id));
    const untouched = exportSnapshotToSources(snapshot, index).filter(
      (mod) => !importedIds.has(mod.id),
    );
    editedSources = [...untouched, ...importedSources].sort((a, b) =>
      compareStrings(a.id, b.id),
    );
  }

  const proposal = importSourcesAsTransaction(snapshot, index, editedSources, {
    branch,
    ...(operationClass !== undefined ? { operationClass } : {}),
    ...(approveRequirementEdit ? { approvedRequirementEdit: true } : {}),
    ...(message !== undefined ? { message } : {}),
  });

  if (proposal.operations.length === 0) {
    emitResult(
      json,
      {
        ok: true,
        value: {
          branch,
          changed: false,
          operationClass: proposal.operationClass,
          snapshot: snapshotSummary(snapshot),
          operations: [],
        },
        diagnostics: [],
      },
      () => `No semantic changes on branch '${branch}' (${snapshot.hash}).`,
    );
    return true;
  }

  const result: TransactionResult = store.submitTransaction(proposal);
  if (!result.ok) {
    const diagnostics = [
      { code: `store/${result.reason}`, severity: "error" as const, message: result.message },
      ...(result.policyViolations ?? []).map((v) => ({
        code: `store/policy/${v.rule}`,
        severity: "error" as const,
        message: v.message,
      })),
      ...(result.diagnostics ?? []).map((d) => ({
        code: d.code ?? "store/diagnostic",
        severity: "error" as const,
        message: d.message,
      })),
    ];
    emitResult(
      json,
      {
        ok: false,
        value: {
          ok: false,
          reason: result.reason,
          message: result.message,
          ...(result.policyViolations ? { policyViolations: result.policyViolations } : {}),
          ...(result.conflict ? { conflict: result.conflict } : {}),
          ...(result.impacts ? { impacts: result.impacts } : {}),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        },
        diagnostics,
      },
      () => "",
    );
    return true;
  }

  const nextIndex = store.getSnapshotIndex(result.snapshot.hash);
  if (nextIndex) {
    const touchedHashes = new Set<string>([
      ...result.diff.added.map((a) => a.hash),
      ...result.diff.updated.map((u) => u.newHash),
    ]);
    const touchedRecords: DefinitionRecord[] = [];
    for (const hash of touchedHashes) {
      const rec = nextIndex.definitions.get(hash);
      if (rec) touchedRecords.push(rec);
    }
    recordTypecheckEvidenceForRecords(
      evidenceCache,
      touchedRecords,
      result.snapshot.languageProfile,
    );
  }

  const evidenceStats = evidenceCache.stats();
  const value = {
    branch: result.branch,
    changed: true,
    operationClass: proposal.operationClass,
    previousHead: result.previousHead,
    snapshot: snapshotSummary(result.snapshot),
    diff: result.diff,
    metrics: result.metrics,
    evidence: evidenceStats,
  };

  emitResult(
    json,
    { ok: true, value, diagnostics: [] },
    () =>
      [
        `Committed to branch '${result.branch}' (${proposal.operationClass})`,
        `Previous:    ${result.previousHead}`,
        `Snapshot:    ${result.snapshot.hash}`,
        `Changes:     +${result.diff.added.length} ~${result.diff.updated.length} -${result.diff.removed.length} R${result.diff.renamed.length}`,
      ].join("\n"),
  );
  return true;
}

export async function storeCommand(args: readonly string[]): Promise<boolean> {
  const [subcommand, ...rest] = args;
  if (!subcommand) return false;
  switch (subcommand) {
    case "init":
      return handleInit(rest);
    case "status":
      return handleStatus(rest);
    case "branches":
      return handleBranches(rest);
    case "query":
      return handleQuery(rest);
    case "diff":
      return handleDiff(rest);
    case "export":
      return handleExport(rest);
    case "import":
      return handleImport(rest);
    default:
      return false;
  }
}
