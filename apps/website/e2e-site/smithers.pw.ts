import { expect, test } from "@playwright/test";

test("the Smithers example opens both files and compiles in the production worker bundle", async ({ page }) => {
  await page.goto("/playground/custom?example=smithers");
  await expect(page.getByRole("textbox", { name: "Example title" })).toHaveValue("Smithers workflows: a Forma frontend");
  const output = page.getByRole("tabpanel");
  await expect(output).toHaveAttribute("aria-busy", "false");
  await expect(output).toContainText("No diagnostics.");
  await expect(output).toContainText('"kind": "Action"');
  await expect(page.getByRole("textbox", { name: "Prelude source", exact: true })).toContainText("Smithers workflow frontend");
  await expect(page.getByRole("textbox", { name: "Example source", exact: true })).toContainText("action implement");
});
