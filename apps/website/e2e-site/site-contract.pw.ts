import { expect, test } from "@playwright/test";
import family from "../../../docs/.vitepress/family.json" with { type: "json" };
import navigation from "../../../docs/.vitepress/navigation.json" with { type: "json" };

test("discovery endpoints are real assets with the right media types", async ({ request }) => {
  for (const [path, type, marker] of [
    ["/feed.xml", "application/atom+xml", '<feed xmlns="http://www.w3.org/2005/Atom">'],
    ["/sitemap.xml", "application/xml", "https://forma-lang.com/preludes/kernel"],
    ["/robots.txt", "text/plain", "Sitemap: https://forma-lang.com/sitemap.xml"],
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
    expect(await response.text()).toContain(marker);
    expect(await response.text()).not.toContain("<!doctype html>");
  }
  const image = await request.get("/og-image.png");
  expect(image.headers()["content-type"]).toContain("image/png");
  expect((await image.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("docs and playground share their shell, branding, metadata and theme", async ({ page }) => {
  for (const path of ["/", "/language", "/blog/", "/playground", "/playground/demo", "/playground/custom"]) {
    await page.goto(path);
    const strip = page.getByRole("complementary", { name: "WorldVM family" });
    await expect(strip.getByRole("link")).toHaveCount(family.length);
    for (const project of family) {
      await expect(strip.getByRole("link", { name: `${project.name} ${project.pitch}`, exact: true })).toHaveAttribute("href", project.site);
    }
    const header = page.getByRole("navigation", { name: /^Main navigation$/i });
    for (const item of navigation) {
      await expect(header.getByRole("link", { name: item.text, exact: true })).toHaveAttribute("href", item.link);
    }
    const footer = page.locator(".shared-footer");
    for (const item of navigation) {
      await expect(footer.getByRole("link", { name: item.text, exact: true })).toHaveAttribute("href", item.link);
    }
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/mark.svg");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://forma-lang.com${path}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://forma-lang.com/og-image.png");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /.+/);
    await expect(page.locator("body")).not.toContainText("@formalang");
    await expect(page.locator("body")).not.toContainText("incubation project");
  }
  await page.goto("/");
  await page.getByRole("navigation", { name: /^Main navigation$/i }).getByRole("link", { name: "Learn", exact: true }).click();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://forma-lang.com/language");
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("forma-theme", "dark"));
  await page.goto("/playground");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.goto("/language");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("blog index shows each dated post and About redirects to the guide", async ({ page, request }) => {
  await page.goto("/blog/");
  const feed = await (await request.get("/feed.xml")).text();
  const entries = (feed.match(/<entry>/g) ?? []).length;
  expect(entries).toBeGreaterThan(0);
  await expect(page.locator(".blog-posts time")).toHaveCount(entries);
  const response = await request.get("/playground/about", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers().location).toMatch(/\/language$/);
});
