import { test, expect } from "@playwright/test";

test("home page mounts and renders cleanly", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", (response) => {
    const url = response.url();
    if (baseURL && url.startsWith(baseURL) && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${url}`);
    }
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.locator("#root")).not.toBeEmpty();

  // Leaflet container mounts (HomePage is lazy-loaded behind Suspense)
  await expect(page.locator(".leaflet-container")).toBeVisible({
    timeout: 15_000,
  });

  await page.waitForLoadState("networkidle");

  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  expect(failedRequests, failedRequests.join("\n")).toEqual([]);
});
