import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { ordersSource } from "../src/effectPageSources";

const screenshots = resolve(import.meta.dirname, "../../../.context");
const check = (page: Page) => page.locator(".wb .rd-check");
const editor = (page: Page) => page.getByRole("textbox", { name: "Forma source" });

test("an introduced error is underlined, explained in the inspector, and blocks generated code until reset", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/playground/embed/orders");
  await expect(check(page)).toContainText("Types check");
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(check(page)).toContainText("1 error");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  // The error is selected, so the inspector explains it.
  await expect(page.locator(".rd-inspector")).toContainText("signature declares only [OrderNotFound]");
  await page.getByRole("button", { name: "Toggle the bottom panel" }).click();
  const panel = page.getByRole("region", { name: "Generated TypeScript" });
  await expect(panel).toContainText("Nothing is generated until the file checks");
  await page.screenshot({ path: `${screenshots}/effect-workbench-error.png`, fullPage: true });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(check(page)).toContainText("Types check");
  await expect(panel).toContainText("Schema.Literals");
  // Selecting a form lights up the TypeScript generated from it.
  await editor(page).getByText("(define pay [id]").click();
  await expect(panel.locator(".rd-out-linked").first()).toContainText("pay");
  await editor(page).fill(ordersSource.replace(":shipped", ":shipped :cancelled"));
  await expect(check(page)).toContainText("Types check");
  await expect(panel).toContainText("cancelled");
  expect(errors).toEqual([]);
});

test("the inspector shows the type of the form at the caret", async ({ page }) => {
  await page.goto("/playground/embed/inference");
  await editor(page).fill("(+ 20 3)");
  await expect(check(page)).toContainText("Types check");
  await editor(page).press("ControlOrMeta+End");
  await editor(page).press("ArrowLeft");
  await expect(page.locator(".rd-inspector")).toContainText("Int");
  await editor(page).fill('(+ 20 "oops")');
  await expect(check(page)).toContainText(/\d+ errors?/);
  await expect(page.locator(".wb .cm-lintRange-error")).toBeVisible();
});

test("switching the site theme preserves the document and undo history", async ({ page }) => {
  await page.goto("/playground/live/contracts");
  await expect(check(page)).toContainText("Types check");
  const source = await editor(page).innerText();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n; my draft");
  const dark = await page.locator("html").getAttribute("data-theme") === "dark";
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", dark ? "light" : "dark");
  await expect(editor(page)).toContainText("; my draft");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editor(page).innerText()).toBe(source);
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.screenshot({ path: `${screenshots}/workbench-${dark ? "light" : "dark"}.png`, fullPage: true });
});

test("typing replay shows a real error, repairs it, and lets editing interrupt it", async ({ page }) => {
  await page.goto("/playground/embed/contracts");
  // The replay shows its error for a fixed time; start it once the first check is in.
  await expect(check(page)).toContainText("Types check");
  await page.getByRole("button", { name: "Watch typing" }).click();
  await expect(check(page)).toContainText("1 error");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch typing" })).toBeVisible({ timeout: 10000 });
  await expect(check(page)).toContainText("Types check");
  await page.getByRole("button", { name: "Watch typing" }).click();
  await expect(check(page)).toContainText("1 error");
  await editor(page).fill("; my own program");
  await expect(page.getByRole("button", { name: "Watch typing" })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(editor(page)).toHaveText("; my own program");
});

test("examples switch the code, and the email example shows the email compiler's problems", async ({ page }) => {
  await page.goto("/playground/live/inference");
  await expect(check(page)).toContainText("Types check");
  const examples = page.getByRole("navigation", { name: "Examples" });
  await examples.getByRole("button", { name: "Macros", exact: true }).click();
  await expect(examples.getByRole("button", { name: "Macros", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("tab", { name: /grades\.lisp/ })).toBeVisible();
  await expect(check(page)).toContainText("Types check");
  await examples.getByRole("button", { name: "Email rule lanes" }).click();
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(check(page)).toContainText("1 error");
  await expect(page.locator(".rd-inspector")).toContainText('Expected Union<"gmail", "default">, found "gmial"');
  await expect(page.locator(".rd-file-count.bad")).toHaveText("1");
});

test("mobile workbench stacks the code and the inspector without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/playground/embed/orders?broken=1");
  await expect(check(page)).toContainText("1 error");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: `${screenshots}/effect-workbench-mobile.png`, fullPage: true });
});
