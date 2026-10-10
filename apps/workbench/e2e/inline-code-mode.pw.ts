import { expect, test } from "@playwright/test";

test("runs the transcript, continues from its result, and swaps runtime bindings", async ({ page }) => {
  await page.goto("/?demo=code-mode");
  await expect(page.getByRole("heading", { name: "Lisp, inline." })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Assistant response" });
  const original = await editor.inputValue();
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run complete");
  const result = page.locator(".cm-entry--result");
  await expect(result).toContainText('":open": 2');
  await expect(result).toContainText("Issues.list-open");
  await expect(page.locator(".cm-entry--continuation")).toContainText('":open":2');
  await page.screenshot({ path: "../../.context/inline-code-mode.png", fullPage: true });
  await page.getByRole("button", { name: "Alternate mocks" }).click();
  await expect(editor).toHaveValue(original);
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run complete");
  await expect(result).toContainText('":open": 0');
  await expect(page.locator(".cm-entry--continuation")).toContainText('":open":0');
});

test("denies a mock write, then allows it through explicit runtime authority", async ({ page }) => {
  await page.goto("/?demo=code-mode");
  await page.getByRole("button", { name: "Write example" }).click();
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run failed");
  await expect(page.locator(".cm-entry--result")).toContainText("capability/denied");
  await expect(page.locator(".cm-entry--continuation")).toContainText("No successful result");
  await page.getByRole("button", { name: "Allow mock write" }).click();
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run complete");
  await expect(page.locator(".cm-entry--result")).toContainText("true");
  await expect(page.locator(".cm-entry--result")).toContainText("allowed");
});

test("accepts edits, keeps ordinary examples inert, and rejects a dependent remainder", async ({ page }) => {
  await page.goto("/?demo=code-mode");
  const editor = page.getByRole("textbox", { name: "Assistant response" });
  await editor.fill('Just an example.\n```forma\n(Issues.close "x")\n```\n');
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run complete");
  await expect(page.locator(".cm-entry--result")).toHaveCount(0);
  await editor.fill("```forma-run sum\n(+ 2 3)\n```\nI already know the result.");
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("alert")).toContainText("Dependent text");
  await expect(page.locator(".cm-entry--result")).toHaveCount(0);
  await editor.fill("```forma-run sum\n(+ 2 3)\n```\n");
  await page.getByRole("button", { name: "Run response" }).click();
  await expect(page.getByRole("status")).toHaveText("Run complete");
  await expect(page.locator(".cm-entry--result pre")).toHaveText("5");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Run response" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
