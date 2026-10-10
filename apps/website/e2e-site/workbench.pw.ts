import { expect, test } from "@playwright/test";

test("opens the live workbench from the docs site and loads its own assets on reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await expect(page.locator(".fh-examples").getByRole("link", { name: /Open the workbench/ }))
    .toHaveAttribute("href", "/workbench/demo/");
  await page.getByRole("navigation", { name: "Main Navigation" })
    .getByRole("link", { name: "Workbench", exact: true }).click();
  await expect(page).toHaveURL(/\/workbench\/demo\/$/);
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tree", { name: "Program" })).toBeVisible();
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();
  await page.goto("/workbench/demo");
  await expect(page).toHaveURL(/\/workbench\/demo\/$/);
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();

  const call = page.getByRole("tree", { name: "Program" }).getByRole("treeitem", { name: /^map badge/ });
  await call.locator("textarea").fill('map badge [1 3 7 "x"]');
  await expect(call).toHaveAttribute("data-tone", "error");
  await expect(page.getByText(/1 error ·/)).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Forma source", exact: true }))
    .toHaveValue(/\(map badge \[1 3 7 "x"\]\)/);
  expect(errors).toEqual([]);
});

test("links the examples gallery to the workbench while preserving the design document", async ({ page }) => {
  await page.goto("/playground/demo");
  const demo = page.getByRole("link").filter({
    has: page.getByRole("heading", { name: "Forma Workbench", exact: true }),
  });
  await expect(demo).toHaveAttribute("href", "/workbench/demo/");
  await demo.click();
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();
  await page.getByRole("link", { name: "About this demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^The Forma workbench/, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Open the live demo", exact: true }).click();
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();
  await page.getByRole("navigation", { name: "Site navigation" })
    .getByRole("link", { name: "Examples", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a program to inspect.", exact: true })).toBeVisible();
});

test("the Foldkit page shows workbench captures and opens the live app", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main Navigation" })
    .getByRole("link", { name: "Foldkit", exact: true }).click();
  await expect(page).toHaveURL(/\/foldkit$/);
  await expect(page.getByRole("heading", { name: "Put a typed language inside a Foldkit app.", level: 1 }))
    .toBeVisible();
  for (const image of await page.locator(".fh-window > img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1440);
  }
  await page.locator(".fh-hero").getByRole("link", { name: /Open the workbench/ }).click();
  await expect(page).toHaveURL(/\/workbench\/demo\/$/);
  await expect(page.getByText("14 forms · 0 errors · 2 warnings")).toBeVisible();
  expect(errors).toEqual([]);
});
