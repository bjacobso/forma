import { expect, test, type Page } from "@playwright/test";
import { encodePreludeDemo } from "../src/lib/preludeShare";

const source = (page: Page) => page.getByRole("textbox", { name: "Forma source", exact: true });
const output = (page: Page) => page.getByRole("region", { name: "Compiler output" });
const openFile = (page: Page, file: string) => page.getByRole("tablist", { name: "Files" }).locator(".rd-file", { hasText: file }).getByRole("button").first().click();

/** A language whose program abbreviates its own declarations with a macro. */
const research = {
  title: "Research macro",
  prelude: `(type ResearchIR {:kind "Research" :name Symbol :title String :cost Int})
(form (research name {:keys [title cost]})
  :types {:name (Declares Research) :title String :cost Int}
  :ir ResearchIR
  {:kind "Research" :name name :title title :cost cost})`,
  source: `(macro (quick-research n)
  \`(research ~n :title "x" :cost 1))
(quick-research foo)`,
};

/**
 * Lets a test make the reader's checker fail: while `window.failChecks` is "answer", each
 * analyze request is answered with an error; while it is "crash", the worker reports a crash.
 */
const failableChecker = () => {
  const Real = window.Worker;
  window.Worker = class extends Real {
    override postMessage(message: unknown, options?: unknown) {
      const request = message as { id?: number; kind?: string };
      const mode = (window as unknown as { failChecks?: string }).failChecks;
      if (request?.kind === "analyze" && mode === "answer") {
        setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: { id: request.id, kind: "error", message: "Forced checker failure" } })));
        return;
      }
      if (request?.kind === "analyze" && mode === "crash") {
        setTimeout(() => this.onerror?.(new ErrorEvent("error", { message: "Forced worker crash" })));
        return;
      }
      if (request?.kind === "analyze" && mode === "hang") {
        // Simulate a wedged worker that never answers; ReadingClient must time out and respawn it.
        return;
      }
      super.postMessage(message, options as StructuredSerializeOptions);
    }
  };
};

test("the reader checks declarations the program's own macro produces", async ({ page }) => {
  await page.goto(`/playground/custom${encodePreludeDemo(research)}`);
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);
  await page.getByRole("tab", { name: "Result", exact: true }).click();
  await expect(page.getByRole("region", { name: "Compiler output" }).getByRole("heading", { name: /foo/ })).toBeVisible();
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText('"name": "foo"');

  // A problem in what the macro writes is shown at the call.
  const broken = research.source.replace(':title "x" ', "");
  await source(page).fill(broken);
  await expect(page.locator(".rd-check")).toHaveText(/1 error/);
  const call = broken.indexOf("(quick-research foo)");
  await expect(page.locator(".cm-lintRange-error")).toHaveText("(quick-research foo)");
  expect(await page.locator(".cm-lintRange-error").evaluate(node => node.closest(".cm-line")?.textContent)).toBe(broken.slice(call));
});

test("a checker failure ends Checking… and says why", async ({ page }) => {
  await page.addInitScript(failableChecker);
  await page.goto(`/playground/custom${encodePreludeDemo(research)}`);
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);

  await page.evaluate(() => { (window as unknown as { __formaReadingTimeoutMs?: number }).__formaReadingTimeoutMs = 150; });
  for (const [mode, message] of [["answer", "Forced checker failure"], ["crash", "Forced worker crash"], ["hang", "timed out"]]) {
    await page.evaluate(next => { (window as unknown as { failChecks?: string }).failChecks = next; }, mode);
    await source(page).press("End");
    await source(page).pressSequentially(" ");
    await expect(page.getByRole("alert").filter({ hasText: "Could not check" })).toContainText(message!);
    await expect(page.locator(".rd-check")).not.toHaveText(/Checking/);
  }

  // The next edit after the failure checks again, with a new worker after the crash or timeout.
  await page.evaluate(() => {
    (window as unknown as { failChecks?: string }).failChecks = undefined;
    (window as unknown as { __formaReadingTimeoutMs?: number }).__formaReadingTimeoutMs = undefined;
  });
  await source(page).pressSequentially(" ");
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);
});

/** Records the workers the page starts and the files the reader's worker is asked to analyze. */
const countChecks = () => {
  const Real = window.Worker;
  const seen = { workers: [] as string[], analyzed: [] as string[] };
  (window as unknown as { checks: typeof seen }).checks = seen;
  window.Worker = class extends Real {
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); seen.workers.push(String(url)); }
    override postMessage(message: unknown, options?: unknown) {
      const request = message as { kind?: string; file?: string };
      if (request?.kind === "analyze") seen.analyzed.push(request.file!);
      super.postMessage(message, options as StructuredSerializeOptions);
    }
  };
};
const checks = (page: Page) => page.evaluate(() => {
  const seen = (window as unknown as { checks: { workers: string[]; analyzed: string[] } }).checks;
  const counted = { workers: seen.workers.length, analyzed: [...seen.analyzed] };
  seen.workers.length = 0; seen.analyzed.length = 0;
  return counted;
});

test("each edit is analyzed once, and the status, Result and JSON all show that analysis", async ({ page }) => {
  await page.addInitScript(countChecks);
  await page.goto(`/playground/custom${encodePreludeDemo(research)}`);
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(output(page)).toContainText('"name": "foo"');
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);
  await expect(page.locator(".rd-scope")).toHaveText("Everything prelude.lisp defines is in scope here, without an import.");
  await page.waitForTimeout(600);
  await checks(page);

  // An edit to the program: one analysis of it, and no other checker.
  await source(page).fill(research.source.replace("foo", "bar"));
  await expect(output(page)).toContainText('"name": "bar"');
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);
  await expect(page.getByRole("status").filter({ hasText: "Program checks" })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await checks(page)).toEqual({ workers: 0, analyzed: ["example.lisp"] });

  // An edit to the language definition: one analysis of it, then one of the program it changes.
  await openFile(page, "prelude.lisp");
  await expect(page.locator(".rd-scope")).toHaveCount(0);
  await page.waitForTimeout(600);
  await checks(page);
  await source(page).fill(research.prelude.replaceAll('"Research"', '"Study"'));
  await expect(output(page)).toContainText('"kind": "Study"');
  await page.waitForTimeout(600);
  expect(await checks(page)).toEqual({ workers: 0, analyzed: ["prelude.lisp", "example.lisp"] });
  await page.getByRole("tab", { name: "Result", exact: true }).click();
  await expect(output(page).getByRole("heading", { name: /bar/ })).toBeVisible();
});

test("prelude errors show their actual diagnostic in Result and jump into prelude.lisp", async ({ page }) => {
  const brokenPrelude = {
    ...research,
    prelude: `${research.prelude}\n(+ 1 "nope")`,
  };
  await page.goto(`/playground/custom${encodePreludeDemo(brokenPrelude)}`);
  await page.getByRole("tab", { name: "Result", exact: true }).click();
  const problem = output(page).locator(".rd-problem").filter({ hasText: "prelude.lisp:" }).first();
  await expect(problem).toBeVisible();
  await expect(problem).toContainText(/String|Int|Float/);
  await problem.getByRole("button").click();
  await expect(page.locator(".rd-scope")).toHaveCount(0);
  await expect(source(page)).toContainText('(+ 1 "nope")');
});
