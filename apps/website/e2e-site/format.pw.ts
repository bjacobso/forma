import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("playground Format button and shortcut format atomically", async ({ page }) => {
  await page.goto("/playground/demo/types");
  await page.getByRole("button", { name: "Close tour", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Forma source", exact: true });
  await source.fill("(define   answer 42)\nanswer");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(source).toContainText("(define answer 42)");
  await source.press("Control+z");
  await expect(source).toContainText("(define   answer 42)");
  await source.press("Control+Shift+f");
  await expect(source).toContainText("(define answer 42)");
  await page.locator(".source-pane").screenshot({ path: resolve(import.meta.dirname, "../../../.context/formatter-playground.png") });
});

test("workbench Format and F8 use the source editor's undo history", async ({ page }) => {
  await page.goto("/workbench/demo/");
  await expect(page.getByRole("tree", { name: "Program" })).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Forma source", exact: true });
  const before = "(define   answer 42)\nanswer\n";
  await source.fill(before);
  await expect(source).toHaveValue(before);
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(source).toHaveValue("(define answer 42)\nanswer\n");
  await source.press("Control+z");
  await expect(source).toHaveValue(before);
  await source.press("F8");
  await expect(source).toHaveValue("(define answer 42)\nanswer\n");
});
