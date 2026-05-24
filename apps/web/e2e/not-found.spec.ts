import { test, expect } from "@playwright/test";

test("unknown route renders NotFoundPage via SPA fallback", async ({
  page,
}) => {
  const response = await page.goto("/this-route-does-not-exist-xyz");
  // SPA fallback: Worker serves index.html with 200, React Router renders the * route
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});

test("NotFoundPage 'Back to map' link navigates to home", async ({ page }) => {
  await page.goto("/this-route-does-not-exist-xyz");
  await page.getByRole("link", { name: /back to map/i }).click();
  await expect(page).toHaveURL("/");
});
