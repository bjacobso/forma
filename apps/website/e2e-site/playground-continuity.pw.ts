import { expect, test } from "@playwright/test";
import { defaultPreludeDemo, encodePreludeDemo } from "../src/lib/preludeShare";

test("validation retains the previous output and scroll position, then updates in place", async ({ page }) => {
  await page.addInitScript(() => {
    const bridge = window as unknown as { holdValidation: boolean; resumeValidation?: () => void; outputEditor?: Element | null };
    bridge.holdValidation = false;
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      postMessage(message: unknown) {
        if (bridge.holdValidation) bridge.resumeValidation = () => super.postMessage(message);
        else super.postMessage(message);
      }
    };
  });
  const source = `(workflow before\n${Array.from({ length: 32 }, (_, index) => `  (step check-${index} "process.check")`).join("\n")})`;
  await page.goto(`/playground/custom${encodePreludeDemo({ ...defaultPreludeDemo, source })}`);
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  const output = page.getByRole("tabpanel");
  await expect(output).toHaveAttribute("aria-busy", "false");
  await expect(output).toContainText('"name": "before"');
  const scroller = page.locator(".target-code-view .cm-scroller");
  const scrollTop = await scroller.evaluate(element => { element.scrollTop = 160; return element.scrollTop; });
  expect(scrollTop).toBeGreaterThan(0);
  await page.evaluate(() => {
    const bridge = window as unknown as { holdValidation: boolean; outputEditor: Element | null };
    bridge.holdValidation = true;
    bridge.outputEditor = document.querySelector(".target-code-view .cm-editor");
  });
  await page.getByRole("textbox", { name: "Example source", exact: true }).fill(source.replace("workflow before", "workflow after"));
  await expect(output).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status").filter({ hasText: "Validating… showing previous result" })).toBeVisible();
  await page.waitForFunction(() => Boolean((window as unknown as { resumeValidation?: () => void }).resumeValidation));
  await expect(output).toContainText('"name": "before"');
  await expect(output).not.toContainText('"name": "after"');
  await expect(page.locator(".studio-output-snapshot")).toHaveCSS("opacity", "0.45");
  expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollTop);
  await page.evaluate(() => {
    const bridge = window as unknown as { holdValidation: boolean; resumeValidation: () => void };
    bridge.holdValidation = false;
    bridge.resumeValidation();
  });
  await expect(output).toHaveAttribute("aria-busy", "false");
  await expect(output).toContainText('"name": "after"');
  await expect(page.locator(".studio-output-snapshot")).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => (window as unknown as { outputEditor?: Element }).outputEditor === document.querySelector(".target-code-view .cm-editor"))).toBe(true);
  expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollTop);

  // Appearance changes also preserve the output editor and its viewport.
  await page.getByRole("combobox", { name: "Playground appearance" }).selectOption("light");
  expect(await page.evaluate(() => (window as unknown as { outputEditor?: Element }).outputEditor === document.querySelector(".target-code-view .cm-editor"))).toBe(true);
  expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollTop);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".studio-output-snapshot")).toHaveCSS("transition-duration", "0s");
});

test("the playground uses homepage charcoal surfaces and readable syntax in both appearances", async ({ page }, testInfo) => {
  await page.goto(`/playground/custom${encodePreludeDemo({ ...defaultPreludeDemo, source: defaultPreludeDemo.source + '\n;; Numbers and booleans: 42 true' })}`);
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  const main = page.getByRole("main");
  const output = page.getByRole("tabpanel");
  await expect(output).toHaveAttribute("aria-busy", "false");
  await expect(main).toHaveAttribute("data-theme", "dark");
  const reports = [];
  for (const theme of ["dark", "light"] as const) {
    await page.getByRole("combobox", { name: "Playground appearance" }).selectOption(theme);
    for (const selector of [".studio-file-active .cm-editor", ".target-code-view .cm-editor"]) {
      const report = await page.locator(selector).evaluate(editor => {
        const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (color: string) => {
          const channels = rgb(color).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
          return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
        };
        const background = getComputedStyle(editor).backgroundColor;
        const backgroundLight = luminance(background);
        const colors = [...new Set(Array.from(editor.querySelectorAll(".cm-line span")).map(span => getComputedStyle(span).color))];
        return { background, colors, minContrast: Math.min(...colors.map(color => {
          const light = luminance(color);
          return (Math.max(light, backgroundLight) + .05) / (Math.min(light, backgroundLight) + .05);
        })) };
      });
      expect(report.background).toBe(theme === "dark" ? "rgb(17, 22, 19)" : "rgb(255, 253, 248)");
      expect(report.colors.length).toBeGreaterThanOrEqual(3);
      expect(report.minContrast).toBeGreaterThanOrEqual(4.5);
      reports.push({ theme, selector, ...report });
    }
    await page.screenshot({ path: `../../.context/playground-continuity-${theme}.png`, fullPage: true });
  }
  await page.reload();
  await expect(main).toHaveAttribute("data-theme", "light");
  await testInfo.attach("playground-contrast", { body: JSON.stringify(reports, null, 2), contentType: "application/json" });
});
