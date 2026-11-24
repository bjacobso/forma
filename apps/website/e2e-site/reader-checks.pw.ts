import { expect, test, type Page } from "@playwright/test";
import { encodePreludeDemo } from "../src/lib/preludeShare";

const source = (page: Page) => page.getByRole("textbox", { name: "Forma source", exact: true });

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

  for (const [mode, message] of [["answer", "Forced checker failure"], ["crash", "Forced worker crash"]]) {
    await page.evaluate(next => { (window as unknown as { failChecks?: string }).failChecks = next; }, mode);
    await source(page).press("End");
    await source(page).pressSequentially(" ");
    await expect(page.getByRole("alert").filter({ hasText: "Could not check" })).toContainText(message!);
    await expect(page.locator(".rd-check")).not.toHaveText(/Checking/);
  }

  // The next edit after the failure checks again, with a new worker after the crash.
  await page.evaluate(() => { (window as unknown as { failChecks?: string }).failChecks = undefined; });
  await source(page).pressSequentially(" ");
  await expect(page.locator(".rd-check")).toHaveText(/Types check/);
});
