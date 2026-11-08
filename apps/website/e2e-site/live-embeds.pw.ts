import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const screenshots = resolve(import.meta.dirname, "../../../.context");

for (const route of ["/", "/effect", "/elm", "/email"]) {
  test(`${route} embeds a live compiler and follows the docs theme`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(route);
    const frame = page.frameLocator(".fh-hero__demo iframe");
    if (route === "/") {
      await expect(page.locator(".forma-home iframe")).toHaveCount(1);
      await expect(page.locator(".fh-hero").getByRole("link", { name: "Write your first form", exact: true })).toHaveAttribute("href", "/writing-a-form");
      await page.getByRole("link", { name: "Try the live compiler" }).click();
      await expect(page.locator(".fh-hero__demo iframe")).toBeInViewport();
    }
    await expect(frame.getByRole("status")).toHaveText("0 errors · 0 warnings");
    await frame.getByRole("button", { name: "Introduce error" }).click();
    await expect(frame.locator(".cm-lintRange-error")).toBeVisible();
    await expect(frame.getByRole("status")).toHaveText("1 error · 0 warnings");
    if (route === "/") {
      await frame.getByRole("tab", { name: "Effect TypeScript", exact: true }).click();
      await expect(frame.getByRole("tabpanel")).toContainText("Generation is blocked until the program checks.");
      await frame.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(frame.getByRole("status")).toHaveText("0 errors · 0 warnings");
      await expect(frame.getByRole("tabpanel")).toContainText("export const log");
      await expect(frame.getByRole("tabpanel")).toContainText("yield* consoleService.print(message)");
    }
    const dark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
    await page.getByRole("switch", { name: /Switch to (dark|light) theme/ }).click();
    await expect(frame.getByRole("combobox", { name: "Workbench appearance" })).toHaveValue(dark ? "light" : "dark");
    const reportedHeight = await frame.locator(".live-workbench").evaluate(element => Math.ceil(element.getBoundingClientRect().height));
    await expect(page.locator(".fh-hero__demo iframe")).toHaveCSS("height", `${reportedHeight}px`);
    await page.locator(".fh-hero__demo iframe").screenshot({ path: `${screenshots}/${route === "/" ? "homepage" : `${route.slice(1)}-page`}-embed.png` });
    await page.screenshot({ path: `${screenshots}/${route === "/" ? "homepage" : `${route.slice(1)}-page`}.png`, fullPage: true });
    if (route === "/elm") {
      await frame.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(frame.getByRole("status")).toHaveText("0 errors · 0 warnings");
      for (const theme of ["light", "dark"] as const) {
        const isDark = await page.locator("html").evaluate(element => element.classList.contains("dark"));
        if (isDark !== (theme === "dark")) await page.getByRole("switch", { name: /Switch to (dark|light) theme/ }).click();
        await expect(frame.getByRole("combobox", { name: "Workbench appearance" })).toHaveValue(theme);
        await page.screenshot({ path: `${screenshots}/elm-${theme}.png`, fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("homepage domain stories show checked repairs and honest consumer boundaries", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Define a domain.Give it meaning.");
  const hero = page.getByRole("region", { name: "Domain language stories" });
  await expect(hero).toContainText("Scripted stories, real recorded compiler results. Not live evaluation.");
  for (const [label, diagnostic, repaired, output, boundary] of [
    ["Release plan", 'action must be one of "process.test", "human.approve"', "process.test", '"kind": "Workflow"', "Forma has not run tests"],
    ["Schema & query", "where expects Bool, found String", ":where active", '"employee/department"', "does not execute SQL"],
    ["Effect contract", "Operation log requires Console.print, but its signature declares no requirements.", "[Console.print]", "yield* consoleService.print(message)", "Your host supplies its implementation and authorization"],
  ]) {
    await hero.getByRole("button", { name: label, exact: true }).click();
    await expect(hero.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(hero).toContainText(diagnostic);
    await expect(hero).toContainText("1 recorded error");
    await hero.getByRole("button", { name: "Next step", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(hero).toContainText("0 recorded errors");
    await expect(hero.locator(".hs-source")).toContainText(repaired);
    await expect(hero.getByRole("button", { name: "Next step", exact: true })).toBeFocused();
    await hero.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(hero.locator(".hs-output")).toContainText(output);
    await expect(hero).toContainText(boundary);
    await expect(hero).toContainText("Output shown, not executed.");
  }
  await hero.getByRole("button", { name: "Schema & query", exact: true }).click();
  await expect(hero.getByRole("link", { name: "Inspect the stored entity example" })).toHaveAttribute("href", "/playground/demo/entities");
  await hero.getByRole("button", { name: "Replay", exact: true }).click();
  await page.clock.fastForward(20_000);
  await expect(hero).toContainText("Vocabulary defined");
  await expect(hero).toContainText("Reduced motion · manual steps");
  await hero.getByRole("button", { name: "Step through", exact: true }).click();
  await expect(hero).toContainText("where expects Bool, found String");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await hero.getByRole("button", { name: "Release plan", exact: true }).click();
  await hero.getByRole("button", { name: "Play story", exact: true }).click();
  await expect(hero).toContainText("Vocabulary defined");
  await page.clock.runFor(3000);
  await expect(hero).toContainText("1 recorded error");
  await hero.getByRole("button", { name: "Pause story", exact: true }).click();
  await page.clock.runFor(5000);
  await expect(hero).toContainText("1 recorded error");
  await hero.getByRole("button", { name: "Play story", exact: true }).click();
  await page.clock.runFor(4500);
  await expect(hero).toContainText("Scripted edit in progress");
  await page.clock.runFor(1400);
  await expect(hero).toContainText("0 recorded errors");
  await page.clock.runFor(2200);
  await expect(hero.locator(".hs-output")).toContainText('"kind": "Workflow"');
  await expect(hero.getByRole("button", { name: "Play again", exact: true })).toBeVisible();
  await hero.getByRole("button", { name: "Replay", exact: true }).click();
  await hero.getByRole("button", { name: "Effect contract", exact: true }).click();
  await page.clock.runFor(20_000);
  await expect(hero).toContainText("1 recorded error");
  await expect(hero.getByRole("button", { name: "Play story", exact: true })).toBeVisible();
});

test("the production worker serves cold embed and full-page workbench routes", async ({ page }) => {
  await page.goto("/playground/live/orders");
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("0 errors · 0 warnings");
  await page.goto("/playground/embed/contracts?broken=1");
  await expect(page.getByRole("status")).toHaveText("1 error · 0 warnings");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
});
