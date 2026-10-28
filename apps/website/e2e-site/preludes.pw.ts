import { expect, test } from "@playwright/test";

test("generates prelude reference pages from their sources", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main Navigation" })
    .getByRole("link", { name: "Preludes", exact: true }).click();
  await expect(page).toHaveURL(/\/preludes\/$/);
  await page.getByRole("link", { name: /Email automation rules/ }).click();
  await expect(page).toHaveURL(/\/preludes\/email$/);
  await expect(page.getByRole("heading", { name: "email", level: 1 })).toBeVisible();

  // The form, its slot types, signatures, and doc comments come from preludes/email.lisp.
  const rule = page.locator(".fp-entry").filter({ has: page.locator("#form-rule") });
  await expect(rule.locator("h3")).toContainText("(rule name lanes clause ...)");
  await expect(rule.locator(".fp-slots")).toContainText("(List Syntax)");
  const tag = page.locator(".fp-entry").filter({ has: page.locator("#fn-tag") });
  await expect(tag).toContainText("(: tag? (-> EmailContact String Bool))");
  await expect(tag).toContainText("Predicates take the contact first; rules omit it.");

  const frame = page.frameLocator(".vp-doc iframe").first();
  await expect(frame.getByRole("status")).toHaveText("0 errors · 0 warnings");

  await page.goto("/preludes/ontology");
  await expect(page.locator("#examples")).toBeVisible();
  await expect(page.locator(".fp-catalog li").first()).toBeVisible();
  expect(errors).toEqual([]);
});
