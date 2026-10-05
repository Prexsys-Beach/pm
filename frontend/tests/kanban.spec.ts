import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
};

test("loads the kanban board", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  await login(page);
  const cardTitle = `Playwright card ${Date.now()}`;
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill(cardTitle);
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText(cardTitle)).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await login(page);
  const cardTitle = `Move me ${Date.now()}`;

  const sourceColumn = page.getByTestId("column-col-backlog");
  await sourceColumn.getByRole("button", { name: /add a card/i }).click();
  await sourceColumn.getByPlaceholder("Card title").fill(cardTitle);
  await sourceColumn.getByPlaceholder("Details").fill("Drag target card.");
  await sourceColumn.getByRole("button", { name: /add card/i }).click();

  const card = sourceColumn.getByText(cardTitle);
  const targetColumn = page.getByTestId("column-col-review");
  await card.dragTo(targetColumn);
  await expect(targetColumn.getByText(cardTitle)).toBeVisible();
});

test("moves a card from in progress to discovery", async ({ page }) => {
  await login(page);
  const cardTitle = `Progress move ${Date.now()}`;

  const sourceColumn = page.getByTestId("column-col-progress");
  await sourceColumn.getByRole("button", { name: /add a card/i }).click();
  await sourceColumn.getByPlaceholder("Card title").fill(cardTitle);
  await sourceColumn.getByPlaceholder("Details").fill("Move to discovery.");
  await sourceColumn.getByRole("button", { name: /add card/i }).click();

  const card = sourceColumn.getByText(cardTitle);
  const targetColumn = page.getByTestId("column-col-discovery");
  await card.dragTo(targetColumn);

  await expect(targetColumn.getByText(cardTitle)).toBeVisible();
  await expect(page.getByTestId("column-col-backlog").getByText(cardTitle)).toHaveCount(0);
});

test("persists authenticated session across refresh and supports logout", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: /sign in to continue/i })).toBeVisible();
});
