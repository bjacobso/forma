import { expect, test } from "@playwright/test";
import { defaultPreludeDemo, encodePreludeDemo } from "../src/lib/preludeShare";

test("a cold shared link loads a custom prelude and editable example", async ({ page }) => {
  const demo = { ...defaultPreludeDemo, prelude: defaultPreludeDemo.prelude.replaceAll('"Step"', '"Task"'), title: "My shared workflow", source: '(workflow shared (step check "process.check"))' };
  await page.goto(`/playground/custom${encodePreludeDemo(demo)}`);
  await expect(page.getByRole("textbox", { name: "Example title" })).toHaveValue(demo.title);
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText('"name": "shared"');
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText('"kind": "Task"');
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText("No diagnostics.");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  const source = page.getByRole("textbox", { name: "Example source", exact: true });
  await source.fill('(workflow shared (step check 42))');
  await expect(page.locator(".diagnostic-error")).toBeVisible();
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText("No diagnostics.");
  await page.getByRole("button", { name: "Share playground" }).click();
  await expect(page).toHaveURL(/\/playground\/p\/[a-f0-9]{32}$/);
  const sharedUrl = page.url();
  const metadata = await (await page.request.get(sharedUrl)).text();
  expect(metadata).toContain('<meta property="og:title" content="My shared workflow - Forma" />');
  await page.reload();
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText('"action": "process.check"');
  await expect(page.getByRole("region", { name: "Compiler output" })).toContainText('"kind": "Task"');
  await page.screenshot({ path: "../../.context/prelude-share-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../.context/prelude-share-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("missing saved playgrounds return 404", async ({ request }) => {
  const response = await request.get(`/playground/p/${"0".repeat(32)}`);
  expect(response.status()).toBe(404);
});
