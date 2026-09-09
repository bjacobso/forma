import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";

interface EditorReport {
  readonly background: string;
  readonly color: string;
  readonly contrast: number;
  readonly distinctTokenColors: number;
  readonly minTokenContrast: number;
  readonly tokenColors: readonly string[];
}

for (const theme of ["light", "dark"] as const) {
  test(`effect target is readable in ${theme} mode`, async ({ page }, testInfo) => {
    await setTheme(page, theme);
    await page.goto("/playground/demo/effect-ts", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "Target: Effect-Flavored TypeScript" })).toBeVisible();

    await stageButton(page, "Source").click();
    await expect(page.locator(".embedded-editor .cm-line").first()).toBeVisible();
    const sourceReport = await analyzeEditor(page, ".embedded-editor .cm-editor");
    expectReadableEditor(sourceReport);

    await stageButton(page, "Target").click();
    await expect(page.locator(".target-code-view .cm-line").first()).toBeVisible();
    await expect(page.getByText("Generated Effect TypeScript")).toBeVisible();
    const targetReport = await analyzeEditor(page, ".target-code-view .cm-editor");
    expectReadableEditor(targetReport);

    await testInfo.attach(`theme-analysis-${theme}`, {
      body: JSON.stringify({ source: sourceReport, target: targetReport }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`effect-ts-${theme}.png`),
    });
  });
}

function stageButton(page: Page, label: string) {
  return page.locator(".stage-rail button").filter({ hasText: label });
}

async function setTheme(page: Page, theme: Theme) {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("forma-theme", nextTheme);
  }, theme);
}

function expectReadableEditor(report: EditorReport) {
  expect(report.contrast).toBeGreaterThanOrEqual(7);
  expect(report.distinctTokenColors).toBeGreaterThanOrEqual(3);
  expect(report.minTokenContrast).toBeGreaterThanOrEqual(4.5);
}

async function analyzeEditor(page: Page, selector: string): Promise<EditorReport> {
  return page.locator(selector).evaluate((editor) => {
    function effectiveBackground(element: Element): string {
      let current: Element | null = element;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        if (background && background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
          return background;
        }
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }

    function parseRgb(color: string): readonly [number, number, number] {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) throw new Error(`Unsupported color: ${color}`);
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function contrastRatio(
      [r1, g1, b1]: readonly [number, number, number],
      [r2, g2, b2]: readonly [number, number, number],
    ): number {
      const l1 = relativeLuminance(r1, g1, b1);
      const l2 = relativeLuminance(r2, g2, b2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function relativeLuminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
    }

    const background = effectiveBackground(editor);
    const color = getComputedStyle(editor).color;
    const tokenColors = Array.from(editor.querySelectorAll(".cm-line span"))
      .map((span) => getComputedStyle(span).color)
      .filter((tokenColor, index, colors) => colors.indexOf(tokenColor) === index);
    const tokenContrasts = tokenColors.map((tokenColor) =>
      contrastRatio(parseRgb(tokenColor), parseRgb(background)),
    );
    return {
      background,
      color,
      contrast: contrastRatio(parseRgb(color), parseRgb(background)),
      distinctTokenColors: tokenColors.length,
      minTokenContrast: tokenContrasts.length === 0 ? 0 : Math.min(...tokenContrasts),
      tokenColors,
    };
  });
}
