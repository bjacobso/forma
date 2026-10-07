import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const screenshots = resolve(import.meta.dirname, "../../../.context");

for (const route of ["/", "/effect"]) {
  test(`${route} embeds a live compiler and follows the docs theme`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(route);
    const frame = page.frameLocator(".fh-hero__demo iframe");
    await expect(frame.getByRole("status")).toHaveText("0 errors · 0 warnings");
    await frame.getByRole("button", { name: "Introduce error" }).click();
    await expect(frame.locator(".cm-lintRange-error")).toBeVisible();
    await expect(frame.getByRole("status")).toHaveText("1 error · 0 warnings");
    const dark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
    await page.getByRole("switch", { name: /Switch to (dark|light) theme/ }).click();
    await expect(frame.getByRole("combobox", { name: "Workbench appearance" })).toHaveValue(dark ? "light" : "dark");
    const reportedHeight = await frame.locator(".live-workbench").evaluate(element => Math.ceil(element.getBoundingClientRect().height));
    await expect(page.locator(".fh-hero__demo iframe")).toHaveCSS("height", `${reportedHeight}px`);
    await page.locator(".fh-hero__demo iframe").screenshot({ path: `${screenshots}/${route === "/" ? "homepage" : "effect-page"}-embed.png` });
    await page.screenshot({ path: `${screenshots}/${route === "/" ? "homepage" : "effect-page"}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("the production worker serves cold embed and full-page workbench routes", async ({ page }) => {
  await page.goto("/playground/live/orders");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.goto("/playground/embed/contracts?broken=1");
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
});
