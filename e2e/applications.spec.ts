import { expect, test } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? process.env.APP_PASSWORD;

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Next injects its own role=alert route announcer outside <main>; scope to the page content.
  await expect(page.locator("main").getByRole("alert")).toHaveText("Wrong password");
});

test("sign in, add an application, see it in the list", async ({ page }) => {
  // Locally a missing password skips; in CI it must fail, or a missing secret would pass silently.
  if (process.env.CI) {
    expect(password, "E2E_PASSWORD must be set in CI").toBeTruthy();
  } else {
    test.skip(!password, "E2E_PASSWORD not set");
  }
  const company = `Acme ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  await page.getByLabel("Company").fill(company);
  await page.getByLabel("Role").fill("Staff Engineer");
  await page.getByRole("button", { name: "Add application" }).click();

  await expect(page.getByRole("list", { name: "Applications" })).toContainText(company);
});

test("shows the application count above the list", async ({ page }) => {
  // Same gating as the sign-in test above: a missing password fails in CI and skips locally.
  if (process.env.CI) {
    expect(password, "E2E_PASSWORD must be set in CI").toBeTruthy();
  } else {
    test.skip(!password, "E2E_PASSWORD not set");
  }

  await page.goto("/login");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  const countLabel = page.getByText(/^\d+ applications?$/);
  await expect(countLabel).toBeVisible();
  const listed = await page.getByRole("list", { name: "Applications" }).getByRole("listitem").count();
  await expect(countLabel).toHaveText(`${listed} ${listed === 1 ? "application" : "applications"}`);
});
