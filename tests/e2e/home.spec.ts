import { expect, test } from "@playwright/test";

test("home page renders the heading and nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const label of ["Overview", "My contracts", "Audit workspace", "Disputes", "Getting started"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});

test("nav link opens the submit page with the upload form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create a bounty", exact: true }).click();
  await expect(page).toHaveURL(/\/submit$/);
  await expect(page.getByRole("heading", { name: "Submit a contract" })).toBeVisible();
  await expect(page.getByLabel(/Contract source/)).toHaveAttribute("type", "file");
  await expect(page.getByLabel("Bounty amount")).toBeVisible();
  await expect(page.getByLabel("Deadline")).toBeVisible();
});
