import { expect, test } from "@playwright/test";

test("full pipeline target stays live and example links keep the playground base path", async ({ page }) => {
  await page.goto("/playground/demo/full-pipeline?step=0", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "The Complete Pipeline" })).toBeVisible();
  for (const stage of ["Source", "Read", "Expand", "Typecheck", "Eval", "Target"]) {
    await expect(page.locator(".stage-rail button").filter({ hasText: stage })).toBeEnabled();
  }

  await page.locator(".stage-rail button").filter({ hasText: "Target" }).click();
  await expect(page.locator(".target-code-view")).toContainText('"A"');

  await page.locator(".stage-rail button").filter({ hasText: "Source" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("(map (fn [score] (+ score 1)) [1 2 3])");
  await page.locator(".stage-rail button").filter({ hasText: "Target" }).click();
  await expect(page.locator(".target-code-view")).toContainText("4");

  await page.getByRole("link", { name: "Next example" }).click();
  await expect(page).toHaveURL(/\/playground\/demo\/types/);
  await page.getByRole("link", { name: "Examples", exact: true }).first().click();
  await expect(page).toHaveURL(/\/playground\/demo$/);
  await expect(page.getByRole("heading", { name: "Choose a program to inspect." })).toBeVisible();
});
