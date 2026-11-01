import { expect, test } from "@playwright/test";
import { FORMA_WORKBENCH_URL } from "../src/lib/workbenchLocation";

test("links to the Foldworks-hosted workbench while keeping the Forma guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".fh-examples").getByRole("link", { name: /Open the workbench/ }))
    .toContainText("Foldworks");
  await expect(page.getByRole("navigation", { name: "Main Navigation" })
    .getByRole("link", { name: "Workbench (Foldworks)", exact: true })).toHaveAttribute("href", FORMA_WORKBENCH_URL);
  await page.goto("/playground/demo");
  const demo = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Forma Workbench", exact: true }) });
  await expect(demo).toHaveAttribute("href", FORMA_WORKBENCH_URL);
  await expect(page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Workbench (Foldworks)", exact: true })).toHaveAttribute("href", FORMA_WORKBENCH_URL);
  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "The Forma workbench in Foldworks", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the workbench in Foldworks", exact: true }))
    .toHaveAttribute("href", "/workbench/demo/");
});

test("the production Worker redirects both legacy paths without serving an app shell", async ({ request }) => {
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/workbench/demo", "/workbench/demo/"]) {
      const response = await request.fetch(`${path}?example=pricing`, { method, maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe(`${FORMA_WORKBENCH_URL}?example=pricing`);
    }
  }
  const retiredAsset = await request.get("/workbench/demo/assets/retired.js");
  expect(retiredAsset.status()).toBe(404);
});
