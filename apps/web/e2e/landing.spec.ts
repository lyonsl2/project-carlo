import { test, expect } from "@playwright/test";

test("landing page mounts cleanly", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto("/landing");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", { name: /Project Carlo/i }),
  ).toBeVisible();

  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
