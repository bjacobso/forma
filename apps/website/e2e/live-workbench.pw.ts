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
  await expect(page.locator(".workbench-contract")).toContainText("PaymentDeclined");
  await page.getByRole("tab", { name: "Effect TypeScript" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Generation is blocked");
  await page.locator(".workbench-diagnostic").click();
  await expect(page.getByRole("textbox", { name: "Forma source" })).toBeFocused();
  await page.screenshot({ path: `${screenshots}/effect-workbench-error.png`, fullPage: true });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await expect(page.locator(".target-code-view")).toContainText("Schema.Literals");
  await page.getByRole("textbox", { name: "Forma source" }).fill(ordersSource.replace(":shipped", ":shipped :cancelled"));
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await expect(page.locator(".target-code-view")).toContainText("cancelled");
  expect(errors).toEqual([]);
});

test("appearance and syntax changes preserve the document and undo history", async ({ page }) => {
  await page.goto("/playground/embed/contracts");
  const editor = page.getByRole("textbox", { name: "Forma source" });
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  const source = await editor.innerText();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n; my draft");
  await page.getByRole("combobox", { name: "Workbench appearance" }).selectOption("dark");
  await page.getByRole("combobox", { name: "Syntax palette" }).selectOption("orchid");
  await expect(editor).toContainText("; my draft");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editor.innerText()).toBe(source);
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.screenshot({ path: `${screenshots}/workbench-dark-orchid.png`, fullPage: true });
  await page.getByRole("combobox", { name: "Workbench appearance" }).selectOption("light");
  await page.getByRole("combobox", { name: "Syntax palette" }).selectOption("ocean");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.screenshot({ path: `${screenshots}/workbench-light-ocean.png`, fullPage: true });
});

test("typing replay shows a real error, repairs it, and lets editing interrupt it", async ({ page }) => {
  await page.goto("/playground/embed/contracts");
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
  await expect(page.locator(".workbench-contract")).toContainText("subtotal");
  await page.getByRole("combobox", { name: "Workbench example" }).selectOption("macros");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.getByRole("tab", { name: "Expand", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("if");
  await page.getByRole("tab", { name: "Value", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText('"A"');
  await page.getByRole("button", { name: "Introduce error" }).click();
  await expect(page.getByRole("status")).toHaveText(/\d+ errors? · 0 warnings/);
  await expect(page.locator(".workbench-diagnostic").first()).toBeVisible();
});

test("mobile workbench stacks source and output without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/playground/embed/orders?broken=1");
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${screenshots}/effect-workbench-mobile.png`, fullPage: true });
});
