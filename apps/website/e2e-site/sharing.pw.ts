import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.getByRole("textbox", { name: "Forma source", exact: true });
const tab = (page: Page, id: string) => page.getByRole("tablist", { name: "Files" }).getByRole("tab").filter({ hasText: id });

async function typeAtEnd(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

async function publish(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("region", { name: "Public snapshot" })).toContainText("publicly readable");
  await page.getByRole("button", { name: "Publish snapshot", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Share link" })).toHaveValue(/snapshot=[a-f0-9]{32}$/);
  const link = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  expect(page.url()).toBe(link);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  return link;
}

test("the reader keeps a draft across reloads and shares its files, active file, and preludes", async ({ page, browser }) => {
  await page.goto("/playground/read?example=functions");
  await expect(page.getByText("Types check")).toBeVisible();
  await typeAtEnd(page, "\n\n(define shared-mark 42)");
  await page.getByRole("button", { name: "New file" }).first().click();
  await expect(tab(page, "untitled-1.lisp")).toHaveAttribute("aria-selected", "true");
  await typeAtEnd(page, "(define other-file 1)");
  await page.getByRole("complementary", { name: "Files and outline" }).getByRole("button", { name: "cluster.lisp" }).click();
  await expect(tab(page, "forma:cluster.lisp")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Unshared draft, kept in this browser.")).toBeVisible();

  // Reload: the draft comes back, with the same tabs and the same file shown.
  await page.reload();
  await expect(page.getByText(/Restored your unshared draft from/)).toBeVisible();
  await expect(tab(page, "forma:cluster.lisp")).toHaveAttribute("aria-selected", "true");
  await tab(page, "untitled-1.lisp").getByRole("button").first().click();
  await expect(editor(page)).toContainText("(define other-file 1)");
  await tab(page, "main.lisp").getByRole("button").first().click();
  await expect(editor(page)).toContainText("(define shared-mark 42)");
  await tab(page, "forma:cluster.lisp").getByRole("button").first().click();

  // Cancel publishes nothing and returns focus to Share.
  const draftUrl = page.url();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeFocused();
  expect(page.url()).toBe(draftUrl);
  const link = await publish(page);
  expect(link).toMatch(/\/playground\/read\?snapshot=[a-f0-9]{32}$/);
  await expect(page.getByText("Shared snapshot", { exact: true })).toBeVisible();

  // A cold load in another browser opens exactly what was shared.
  const other = await browser.newContext();
  const visitor = await other.newPage();
  const response = await visitor.goto(link);
  expect(response?.status()).toBe(200);
  expect(await response?.text()).toContain('<meta property="og:title" content="Shared Forma code - Forma" />');
  await expect(tab(visitor, "forma:cluster.lisp")).toHaveAttribute("aria-selected", "true");
  await expect(visitor.getByRole("tablist", { name: "Files" }).getByRole("tab")).toHaveText(["main.lisp", "untitled-1.lisp", "forma:cluster.lisp"]);
  await expect(editor(visitor)).toContainText("(entity");
  await expect(visitor.getByText("Shared snapshot", { exact: true })).toBeVisible();
  await expect(visitor.getByText(/Restored/)).toHaveCount(0);
  await tab(visitor, "untitled-1.lisp").getByRole("button").first().click();
  await expect(editor(visitor)).toContainText("(define other-file 1)");
  await tab(visitor, "main.lisp").getByRole("button").first().click();
  await expect(editor(visitor)).toContainText("(define shared-mark 42)");
  // Showing another file is not an edit, so the visitor has no draft.
  await expect(visitor.getByRole("button", { name: "Discard draft" })).toHaveCount(0);
  await other.close();

  // Later edits are a draft of the snapshot until discarded.
  await tab(page, "main.lisp").getByRole("button").first().click();
  await typeAtEnd(page, "\n(define after-share 2)");
  await expect(page.getByText("Unshared draft, kept in this browser.")).toBeVisible();
  await page.reload();
  await expect(editor(page)).toContainText("(define after-share 2)");
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(editor(page)).not.toContainText("(define after-share 2)");
  await expect(page.getByText("Shared snapshot", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Restored/)).toHaveCount(0);
  await tab(page, "main.lisp").getByRole("button").first().click();
  await expect(editor(page)).toContainText("(define shared-mark 42)");
  await expect(editor(page)).not.toContainText("(define after-share 2)");

  // The example itself was not changed by sharing: its draft moved to the snapshot.
  await page.goto("/playground/read?example=functions");
  await expect(editor(page)).not.toContainText("shared-mark");
  await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(0);
});

test("the workbench keeps a draft of its example and source, and shares them", async ({ page, browser }) => {
  await page.goto("/playground/live/contracts");
  await page.getByRole("navigation", { name: "Examples" }).getByRole("button", { name: "Order payments" }).click();
  await expect(page.getByText("Types check")).toBeVisible();
  await typeAtEnd(page, "\n\n(define workbench-mark 7)");
  await expect(page.getByText("Unshared draft, kept in this browser.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Restored your unshared draft from/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Order payments" })).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toContainText("(define workbench-mark 7)");

  const link = await publish(page);
  expect(link).toMatch(/\/playground\/live\/orders\?snapshot=[a-f0-9]{32}$/);
  const other = await browser.newContext();
  const visitor = await other.newPage();
  expect((await visitor.goto(link))?.status()).toBe(200);
  await expect(visitor.getByRole("button", { name: "Order payments" })).toHaveAttribute("aria-pressed", "true");
  await expect(editor(visitor)).toContainText("(define workbench-mark 7)");
  await expect(visitor.getByText("Shared snapshot", { exact: true })).toBeVisible();
  await other.close();

  // Discarding a draft of the example returns to the example.
  await page.goto("/playground/live/inference");
  await typeAtEnd(page, "\n(define discard-me 1)");
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(editor(page)).not.toContainText("discard-me");
  await page.reload();
  await expect(editor(page)).not.toContainText("discard-me");
  await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(0);
});

test("links to missing snapshots are 404s, and snippets and embeds keep no drafts", async ({ page, request }) => {
  for (const path of [`/playground/read?snapshot=${"0".repeat(32)}`, `/playground/live/orders?snapshot=${"0".repeat(32)}`]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  await page.goto("/playground/embed/inference");
  await typeAtEnd(page, "\n(define embedded 1)");
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await page.goto("/playground/read/snippets");
  await page.getByRole("textbox", { name: "Forma source" }).first().click();
  await page.keyboard.type("(define in-snippet 1) ");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("forma-draft:")))).toEqual([]);
});
