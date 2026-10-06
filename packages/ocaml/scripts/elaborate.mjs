import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { packageDir, readPreludes } from "./corpus.mjs";

const nativeCli = resolve(packageDir, "dist/native/forma_cli.exe");

const daemon = spawn(nativeCli, ["daemon"], {
  cwd: packageDir,
  stdio: ["pipe", "pipe", "pipe"],
});

const daemonExit = new Promise((resolveExit) => daemon.on("close", resolveExit));

let stderr = "";
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const responses = [];
const waiters = [];
const lines = createInterface({ input: daemon.stdout });

lines.on("line", (line) => {
  responses.push(line);
  const waiter = waiters.shift();
  if (waiter) waiter();
});

const waitForLine = async () => {
  if (responses.length > 0) return responses.shift();
  return new Promise((resolveLine, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon response. stderr: ${stderr}`));
    }, 5000);
    waiters.push(() => {
      clearTimeout(timeout);
      resolveLine(responses.shift());
    });
  });
};

const request = async (payload) => {
  daemon.stdin.write(`${JSON.stringify(payload)}\n`);
  const line = await waitForLine();
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Could not parse daemon response ${JSON.stringify(line)}: ${error}`);
  }
};

const expectOk = (label, response) => {
  if (response?.ok !== true) {
    throw new Error(`${label} failed:\n${JSON.stringify(response, null, 2)}`);
  }
};

const entryValue = (mapValue, keyValue) => {
  const entry = mapValue?.entries?.find((candidate) => candidate.key?.value === keyValue);
  return entry?.value;
};

const preludes = readPreludes();

const sourceId = "elaborate/basic";
const source = `
(entity Employee {:name String
    :status (Option String)
    :department (Option (Id Department))})

(relation works-at Employee Department {:start-date (Option Number)
    :status (Option String)})

(query employee-directory
  :from Employee
  :select [name status])

(seed Employee "employee:ada" {:name "Ada Lovelace"
  :status "active"
  :department "department:platform"})

(link works-at "employee:ada" "department:platform" {:status "active"})

(: mark-active (-> Employee (Action Bool)))
(define mark-active [employee] (do
      (do! [_ (update! Employee employee.id {:status "active"})] true)))

(workspace people-ops :title "People Ops" :persona "Operations" :subject session :home employee-directory-view :views [employee-directory-view department-directory-view])
`;

let sessionId;
let hardFailure;

try {
  const opened = await request({ op: "openSession" });
  expectOk("openSession", opened);
  sessionId = opened.value.sessionId;

  for (const prelude of preludes) {
    const response = await request({
      op: "loadPrelude",
      sessionId,
      ...prelude,
    });
    expectOk(`loadPrelude ${prelude.sourceId}`, response);
  }

  expectOk("load dependencies", await request({op: "loadSource", sessionId, sourceId: "elaborate/dependencies", source: `
(entity Department {:name String})
(view employee-directory-view :title "Employees" :subject session :query employee-directory)
(view department-directory-view :title "Departments" :subject session :query employee-directory)`}));
  const loaded = await request({ op: "loadSource", sessionId, sourceId, source });
  expectOk("loadSource", loaded);

  const response = await request({ op: "elaborate", sessionId, sourceId });
  expectOk("elaborate", response);

  const values = response.value;
  if (!Array.isArray(values) || values.length !== 7) {
    throw new Error(`Expected seven elaborated values: ${JSON.stringify(response, null, 2)}`);
  }

  const [entity, relation, query, record, link, action, workspace] = values;

  if (
    entryValue(entity, ":kind")?.value !== "Entity" ||
    entryValue(entity, ":name")?.value !== "Employee"
  ) {
    throw new Error(`Unexpected entity elaboration: ${JSON.stringify(entity, null, 2)}`);
  }

  if (
    entryValue(relation, ":kind")?.value !== "Relation" ||
    entryValue(relation, ":name")?.value !== "works-at" ||
    entryValue(relation, ":source")?.value !== "Employee" ||
    entryValue(relation, ":target")?.value !== "Department"
  ) {
    throw new Error(`Unexpected relation elaboration: ${JSON.stringify(relation, null, 2)}`);
  }

  if (
    entryValue(query, ":kind")?.value !== "Query" ||
    entryValue(query, ":name")?.value !== "employee-directory"
  ) {
    throw new Error(`Unexpected query elaboration: ${JSON.stringify(query, null, 2)}`);
  }

  if (
    entryValue(record, ":kind")?.value !== "Record" ||
    entryValue(record, ":id")?.value !== "employee:ada"
  ) {
    throw new Error(`Unexpected record elaboration: ${JSON.stringify(record, null, 2)}`);
  }

  if (
    entryValue(link, ":kind")?.value !== "Link" ||
    entryValue(link, ":relation")?.value !== "works-at" ||
    entryValue(link, ":source")?.value !== "employee:ada" ||
    entryValue(link, ":target")?.value !== "department:platform"
  ) {
    throw new Error(`Unexpected link elaboration: ${JSON.stringify(link, null, 2)}`);
  }

  const inputs = entryValue(action, ":inputs");
  if (
    entryValue(action, ":kind")?.value !== "Action" ||
    entryValue(action, ":name")?.value !== "mark-active" ||
    inputs?.kind !== "list" ||
    inputs.items?.[0] == null ||
    entryValue(inputs.items[0], ":name")?.value !== "employee" ||
    entryValue(inputs.items[0], ":type")?.value !== "Employee"
  ) {
    throw new Error(`Unexpected action elaboration: ${JSON.stringify(action, null, 2)}`);
  }

  const views = entryValue(workspace, ":views");
  if (
    entryValue(workspace, ":kind")?.value !== "Workspace" ||
    entryValue(workspace, ":name")?.value !== "people-ops" ||
    views?.kind !== "list" ||
    views.items?.length !== 2 ||
    views.items[0]?.value !== "employee-directory-view" ||
    views.items[1]?.value !== "department-directory-view"
  ) {
    throw new Error(`Unexpected workspace elaboration: ${JSON.stringify(workspace, null, 2)}`);
  }
} catch (error) {
  hardFailure = error;
} finally {
  if (sessionId) {
    try {
      await request({ op: "closeSession", sessionId });
    } catch {
      // The daemon may already be closing after an earlier hard failure.
    }
  }
  daemon.stdin.end();
}

const exitCode = await daemonExit;
if (exitCode !== 0) {
  throw new Error(`Daemon exited with ${exitCode}: ${stderr}`);
}

if (hardFailure) {
  console.error(`forma-ocaml elaborate check failed: ${hardFailure.message}`);
  process.exit(1);
}

console.log("forma-ocaml elaborate ok (7 declarations)");
