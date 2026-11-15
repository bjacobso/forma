import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { ordersSource } from "../src/effectPageSources";

const screenshots = resolve(import.meta.dirname, "../../../.context");

test("diagnostics underline authored calls and generated output follows repairs and edits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/playground/embed/orders");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await expect(page.locator(".wb-stage.bad")).toContainText("Check");
  await expect(page.locator(".wb-problem-meta")).toContainText(/orders\.lisp:\d+:\d+/);
  await expect(page.locator(".wb-problem-source mark")).not.toBeEmpty();
  await page.getByRole("tab", { name: "Contracts" }).click();
  await expect(page.locator(".wb-contract").first()).toContainText("PaymentDeclined");
  const beforeGuidance = await page.getByRole("textbox", { name: "Forma source" }).innerText();
  await page.getByText("Example guidance", { exact: false }).click();
  await expect(page.locator(".wb-guidance")).toContainText("Authored, not an automatic fix");
  await expect(page.getByRole("textbox", { name: "Forma source" })).toHaveText(beforeGuidance, { useInnerText: true });
  await page.getByRole("tab", { name: "Effect TypeScript" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Generation is blocked");
  await page.locator(".wb-problem").click();
  await expect(page.getByRole("textbox", { name: "Forma source" })).toBeFocused();
  await page.screenshot({ path: `${screenshots}/effect-workbench-error.png`, fullPage: true });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  const generated = page.getByRole("tabpanel").locator(".rd-output-code");
  await expect(generated).toContainText("Schema.Literals");
  // Selecting a form lights up the TypeScript generated from it.
  await page.getByRole("textbox", { name: "Forma source" }).getByText("(define pay [id]").click();
  await expect(generated.locator(".rd-out-linked").first()).toContainText("pay");
  await page.getByRole("textbox", { name: "Forma source" }).fill(ordersSource.replace(":shipped", ":shipped :cancelled"));
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await expect(generated).toContainText("cancelled");
  expect(errors).toEqual([]);
});

test("the type at the caret shows under the source without becoming source text", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/playground/embed/inference");
  const editor = page.getByRole("textbox", { name: "Forma source" });
  const typeLine = page.locator(".wb .rd-typeline");
  await editor.fill("(+ 20 3)");
  await editor.press("ControlOrMeta+Home");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await expect(typeLine).toContainText("Int");
  await expect(editor).toHaveText("(+ 20 3)");
  await editor.press("ControlOrMeta+a");
  await editor.press("Backspace");
  await expect(typeLine).toContainText("Hover or click a form");
  await editor.fill('(+ 20 "oops")');
  await expect(page.getByRole("status")).toHaveText(/\d+ errors? · 0 warnings/);
  await expect(page.locator(".wb .cm-lintRange-error")).toBeVisible();
  expect(errors).toEqual([]);
});

test("switching the site theme preserves the document and undo history", async ({ page }) => {
  await page.goto("/playground/live/contracts");
  const editor = page.getByRole("textbox", { name: "Forma source" });
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  const source = await editor.innerText();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n; my draft");
  const dark = await page.locator("html").getAttribute("data-theme") === "dark";
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", dark ? "light" : "dark");
  await expect(editor).toContainText("; my draft");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editor.innerText()).toBe(source);
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.screenshot({ path: `${screenshots}/workbench-${dark ? "light" : "dark"}.png`, fullPage: true });
});

test("typing replay shows a real error, repairs it, and lets editing interrupt it", async ({ page }) => {
  await page.goto("/playground/embed/contracts");
  // The replay shows its error for a fixed time; start it once the first check is in.
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("button", { name: "Watch typing" }).click();
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch typing" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("button", { name: "Watch typing" }).click();
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  await page.getByRole("textbox", { name: "Forma source" }).fill("; my own program");
  await expect(page.getByRole("button", { name: "Watch typing" })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByRole("textbox", { name: "Forma source" })).toHaveText("; my own program");
});

test("core examples expose inference, expansion and evaluated values", async ({ page }) => {
  await page.goto("/playground/embed/inference");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("tab", { name: "Inferred types" }).click();
  await expect(page.locator(".wb-expressions")).toContainText("subtotal");
  await page.getByRole("navigation", { name: "Examples" }).getByRole("button", { name: "Macros → values" }).click();
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("tab", { name: "Expand", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("if");
  await page.getByRole("tab", { name: "Value", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText('"A"');
  await page.getByRole("tab", { name: "Value", exact: true }).press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Expand", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Expand", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.getByRole("status")).toHaveText(/\d+ errors? · 0 warnings/);
  await expect(page.locator(".wb-problem").first()).toBeVisible();
});

test("mobile workbench stacks source and output without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/playground/embed/orders?broken=1");
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: `${screenshots}/effect-workbench-mobile.png`, fullPage: true });
});
