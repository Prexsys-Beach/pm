import { expect, test, type Locator, type Page } from "@playwright/test";

const login = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
};

const dragCardToColumn = async (
  page: Page,
  card: Locator,
  targetColumn: Locator
) => {
  const sourceBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Unable to calculate drag coordinates.");
  }

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, {
    steps: 18,
  });
  await page.mouse.up();
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
  await dragCardToColumn(page, card, targetColumn);
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
  await dragCardToColumn(page, card, targetColumn);

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

test("applies AI-proposed update only after confirmation", async ({ page }) => {
  await login(page);
  const cardTitle = `AI confirm ${Date.now()}`;

  await page.route("**/api/ai/chat", async (route) => {
    const response = {
      assistantMessage: "I prepared one card update.",
      proposedUpdates: [
        {
          action: "create_card",
          columnKey: "col-review",
          title: cardTitle,
          details: "Created after explicit confirmation.",
        },
      ],
      chatHistory: [
        { role: "user", content: "Create a review card" },
        { role: "assistant", content: "I prepared one card update." },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.getByLabel("Prompt").fill("Create a review card");
  await page.getByRole("button", { name: "Send to AI" }).click();

  const reviewColumn = page.getByTestId("column-col-review");
  await expect(page.getByText(`Create card "${cardTitle}" in col-review`)).toBeVisible();
  await expect(reviewColumn.getByText(cardTitle)).toHaveCount(0);

  await page
    .getByTestId("ai-pending-updates")
    .getByRole("button", { name: /^Confirm$/ })
    .first()
    .click();
  await expect(reviewColumn.getByText(cardTitle)).toBeVisible();
});

test("handles repeated AI proposal cycles and keeps confirmed changes after refresh", async ({ page }) => {
  await login(page);
  const acceptedTitle = `AI keep ${Date.now()}`;
  const rejectedTitle = `AI reject ${Date.now()}`;

  let requestCount = 0;
  await page.route("**/api/ai/chat", async (route) => {
    requestCount += 1;
    const response =
      requestCount === 1
        ? {
            assistantMessage: "First proposed update ready.",
            proposedUpdates: [
              {
                action: "create_card",
                columnKey: "col-discovery",
                title: acceptedTitle,
                details: "Should persist after confirmation.",
              },
            ],
            chatHistory: [
              { role: "user", content: "Create one discovery card" },
              { role: "assistant", content: "First proposed update ready." },
            ],
          }
        : {
            assistantMessage: "Second proposed update ready.",
            proposedUpdates: [
              {
                action: "create_card",
                columnKey: "col-done",
                title: rejectedTitle,
                details: "Will be rejected.",
              },
            ],
            chatHistory: [
              { role: "user", content: "Create one done card" },
              { role: "assistant", content: "Second proposed update ready." },
            ],
          };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.getByLabel("Prompt").fill("Create one discovery card");
  await page.getByRole("button", { name: "Send to AI" }).click();
  await page
    .getByTestId("ai-pending-updates")
    .getByRole("button", { name: /^Confirm$/ })
    .first()
    .click();
  await expect(page.getByTestId("column-col-discovery").getByText(acceptedTitle)).toBeVisible();

  await page.getByLabel("Prompt").fill("Create one done card");
  await page.getByRole("button", { name: "Send to AI" }).click();
  await page
    .getByTestId("ai-pending-updates")
    .getByRole("button", { name: /^Reject$/ })
    .first()
    .click();
  await expect(page.getByText(`Create card "${rejectedTitle}" in col-done`)).toHaveCount(0);
  await expect(page.getByTestId("column-col-done").getByText(rejectedTitle)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("column-col-discovery").getByText(acceptedTitle)).toBeVisible();
  await expect(page.getByTestId("column-col-done").getByText(rejectedTitle)).toHaveCount(0);
});
