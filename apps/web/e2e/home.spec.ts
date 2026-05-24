import { test, expect } from "@playwright/test";

test("home page mounts without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.locator("#root")).not.toBeEmpty();
  expect(errors, errors.join("\n")).toEqual([]);
});
