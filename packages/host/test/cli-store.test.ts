import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");
const dirs: string[] = [];

function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "forma-store-cli-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(dir, name), source, "utf8");
  }
  return dir;
}

function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const domainSource = `(export User NotFound Users)
(type User {:id String :name String})
(error NotFound {:id String})
(service Users
  (: find (-> String (Effect (Option User)))))`;

const appSource = `(import "./domain.lisp" [User NotFound Users])
(export find-user greet-user)
(: find-user (-> String (Effect User [NotFound] [Users.find])))
(define find-user [id]
  (do! [found (Users.find id)]
       (match found (Some u) (succeed u) None (fail (NotFound {:id id})))))
(: greet-user (-> String (Effect String [NotFound] [Users.find])))
(define greet-user [id]
  (do! [u (find-user id)]
       (succeed "hello")))
(: double (-> Int Int))
(define double [x] (* x 2))
(test double-test (= (double 3) 6))`;

describe("forma store CLI (RFC 0029)", { timeout: 30_000 }, () => {
  it("runs init -> status -> branches -> query -> export -> edit -> import -> diff with cross-invocation persistence", () => {
    const dir = workspace({
      "domain.lisp": domainSource,
      "app.lisp": appSource,
    });

    // 1. init
    const initRes = run(dir, ["store", "init", "--json"]);
    expect(initRes.status).toBe(0);
    expect(initRes.stderr).toBe("");
    const initJson = JSON.parse(initRes.stdout);
    expect(initJson.ok).toBe(true);
    expect(initJson.value.branch).toBe("main");
    expect(initJson.value.snapshot.hash).toMatch(/^snap:v1:[0-9a-f]{64}$/u);
    expect(initJson.value.snapshot.definitionCount).toBeGreaterThanOrEqual(6);
    expect(initJson.value.evidence.entries).toBeGreaterThanOrEqual(6);
    const head0 = initJson.value.snapshot.hash as string;

    // Verify persistent .forma/store/ layout on disk
    expect(existsSync(join(dir, ".forma", "store", "snapshots", "v1"))).toBe(true);
    expect(existsSync(join(dir, ".forma", "store", "branches", "v1"))).toBe(true);
    expect(existsSync(join(dir, ".forma", "store", "definitions", "v1"))).toBe(true);
    expect(existsSync(join(dir, ".forma", "store", "evidence", "v1"))).toBe(true);

    // 2. status (from a different cwd using --dir to verify persistence & --dir flag)
    const statusRes = run(tmpdir(), ["store", "status", "--dir", dir, "--json"]);
    expect(statusRes.status).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout);
    expect(statusJson).toMatchObject({
      ok: true,
      value: {
        branch: "main",
        head: head0,
        definitionCount: initJson.value.snapshot.definitionCount,
        policyHash: expect.stringMatching(/^policy:v1:[0-9a-f]{64}$/u),
        evidence: {
          entries: initJson.value.evidence.entries,
        },
      },
    });

    // Human-readable status
    const statusHuman = run(dir, ["store", "status"]);
    expect(statusHuman.status).toBe(0);
    expect(statusHuman.stdout).toContain(`Head:        ${head0}`);
    expect(statusHuman.stdout).toContain("Policy hash:");

    // 3. branches
    const branchesRes = run(dir, ["store", "branches", "--json"]);
    expect(branchesRes.status).toBe(0);
    expect(JSON.parse(branchesRes.stdout)).toMatchObject({
      ok: true,
      value: {
        branches: [expect.objectContaining({ name: "main", head: head0 })],
      },
    });

    // 4. query: def, dependents, dependencies, capability, error
    const defRes = run(dir, ["store", "query", "def", "find-user", "--json"]);
    expect(defRes.status).toBe(0);
    const defJson = JSON.parse(defRes.stdout);
    expect(defJson.value.definition).toMatchObject({
      name: "find-user",
      qualifiedName: "app.lisp::find-user",
      requirements: ["Users.find"],
      errors: ["NotFound"],
      evidence: {
        kinds: expect.arrayContaining(["typecheck"]),
      },
    });

    const dependentsDirect = run(dir, ["store", "query", "dependents", "User", "--json"]);
    expect(dependentsDirect.status).toBe(0);
    expect(
      JSON.parse(dependentsDirect.stdout).value.definitions.map((d: { name: string }) => d.name),
    ).toEqual(expect.arrayContaining(["find-user", "Users"]));

    const dependentsTransitive = run(dir, [
      "store",
      "query",
      "dependents",
      "User",
      "--transitive",
      "--json",
    ]);
    expect(dependentsTransitive.status).toBe(0);
    expect(
      JSON.parse(dependentsTransitive.stdout).value.definitions.map((d: { name: string }) => d.name),
    ).toEqual(expect.arrayContaining(["find-user", "greet-user", "Users"]));

    const depsRes = run(dir, ["store", "query", "dependencies", "greet-user", "--json"]);
    expect(depsRes.status).toBe(0);
    expect(
      JSON.parse(depsRes.stdout).value.definitions.map((d: { name: string }) => d.name),
    ).toEqual(expect.arrayContaining(["find-user"]));

    const capRes = run(dir, ["store", "query", "capability", "Users.find", "--json"]);
    expect(capRes.status).toBe(0);
    expect(
      JSON.parse(capRes.stdout).value.definitions.map((d: { name: string }) => d.name),
    ).toEqual(["find-user", "greet-user"]);

    const errRes = run(dir, ["store", "query", "error", "NotFound", "--json"]);
    expect(errRes.status).toBe(0);
    expect(
      JSON.parse(errRes.stdout).value.definitions.map((d: { name: string }) => d.name),
    ).toEqual(["find-user", "greet-user"]);

    // 5. export
    const exportDir = mkdtempSync(join(tmpdir(), "forma-store-export-"));
    dirs.push(exportDir);
    const exportRes = run(dir, ["store", "export", "--out", exportDir, "--json"]);
    expect(exportRes.status).toBe(0);
    const exportJson = JSON.parse(exportRes.stdout);
    expect(exportJson.value.files).toEqual(["app.lisp", "domain.lisp"]);
    const exportedAppPath = join(exportDir, "app.lisp");
    const exportedApp = readFileSync(exportedAppPath, "utf8");
    expect(exportedApp).toContain("(define double [x] (* x 2))");

    // 6. edit exported .lisp (same-interface impl edit) and import
    const editedApp = exportedApp.replace("(* x 2)", "(+ x x)");
    expect(editedApp).not.toBe(exportedApp);
    writeFileSync(exportedAppPath, editedApp, "utf8");

    const importRes = run(dir, [
      "store",
      "import",
      exportDir,
      "--class",
      "impl-edit",
      "--message",
      "Use addition in double",
      "--json",
    ]);
    expect(importRes.status).toBe(0);
    const importJson = JSON.parse(importRes.stdout);
    expect(importJson).toMatchObject({
      ok: true,
      value: {
        branch: "main",
        changed: true,
        operationClass: "impl-edit",
        previousHead: head0,
      },
    });
    const head1 = importJson.value.snapshot.hash as string;
    expect(head1).not.toBe(head0);

    // 7. diff old snapshot hash vs branch name `main`
    const diffRes = run(dir, ["store", "diff", head0, "main", "--json"]);
    expect(diffRes.status).toBe(0);
    const diffJson = JSON.parse(diffRes.stdout);
    expect(diffJson.ok).toBe(true);
    expect(diffJson.value.from).toBe(head0);
    expect(diffJson.value.to).toBe(head1);
    expect(
      diffJson.value.diff.updated.map((u: { qualifiedName: string }) => u.qualifiedName),
    ).toContain("app.lisp::double");

    // Human diff output
    const diffHuman = run(dir, ["store", "diff", head0, head1]);
    expect(diffHuman.status).toBe(0);
    expect(diffHuman.stdout).toContain("~ app.lisp::double");
  });

  it("rejects unauthorized requirement-edit and allows approved requirement-edit", () => {
    const dir = workspace({
      "math.lisp": `(: double (-> Int Int))
(define double [x] (* x 2))
(test double-test (= (double 3) 6))`,
    });

    const initRes = run(dir, ["store", "init", "--json"]);
    expect(initRes.status).toBe(0);
    const head0 = JSON.parse(initRes.stdout).value.snapshot.hash as string;

    // Modify the test in math.lisp
    writeFileSync(
      join(dir, "math.lisp"),
      `(: double (-> Int Int))
(define double [x] (* x 2))
(test double-test (= (double 4) 8))`,
      "utf8",
    );

    // 1. Rejected under --class impl-edit
    const rejectImpl = run(dir, [
      "store",
      "import",
      "math.lisp",
      "--class",
      "impl-edit",
      "--json",
    ]);
    expect(rejectImpl.status).toBe(1);
    expect(JSON.parse(rejectImpl.stdout)).toMatchObject({
      ok: false,
      value: {
        ok: false,
        reason: "policy-violation",
        policyViolations: [expect.objectContaining({ rule: "requirement-edit" })],
      },
    });

    // 2. Rejected under --class requirement-edit without --approve-requirement-edit
    const rejectUnapproved = run(dir, [
      "store",
      "import",
      "math.lisp",
      "--class",
      "requirement-edit",
      "--json",
    ]);
    expect(rejectUnapproved.status).toBe(1);
    expect(JSON.parse(rejectUnapproved.stdout)).toMatchObject({
      ok: false,
      value: {
        ok: false,
        reason: "policy-violation",
        policyViolations: [expect.objectContaining({ rule: "requirement-edit" })],
      },
    });

    // Branch head must still be head0
    const statusAfterReject = JSON.parse(run(dir, ["store", "status", "--json"]).stdout);
    expect(statusAfterReject.value.head).toBe(head0);

    // 3. Succeeds with --class requirement-edit --approve-requirement-edit
    const approved = run(dir, [
      "store",
      "import",
      "math.lisp",
      "--class",
      "requirement-edit",
      "--approve-requirement-edit",
      "--message",
      "Update double-test expectation",
      "--json",
    ]);
    expect(approved.status).toBe(0);
    const approvedJson = JSON.parse(approved.stdout);
    expect(approvedJson.ok).toBe(true);
    expect(approvedJson.value.snapshot.hash).not.toBe(head0);
  });

  it("exits with code 64 on invalid store subcommands or missing required flags", () => {
    const dir = workspace({});
    expect(run(dir, ["store"]).status).toBe(64);
    expect(run(dir, ["store", "bogus"]).status).toBe(64);
    expect(run(dir, ["store", "export"]).status).toBe(64);
    expect(run(dir, ["store", "query", "bogus", "foo"]).status).toBe(64);
    expect(run(dir, ["store", "import"]).status).toBe(64);
  });
});
