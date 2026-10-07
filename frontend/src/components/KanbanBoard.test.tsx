import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { type ApiBoard, toBoardData } from "@/lib/kanban";

const initialApiBoard: ApiBoard = {
  boardId: 1,
  userId: 1,
  title: "Kanban Board",
  columns: [
    {
      key: "col-backlog",
      title: "Backlog",
      position: 1,
      cards: [{ id: 1, title: "Card one", details: "Notes", position: 1 }],
    },
    { key: "col-discovery", title: "Discovery", position: 2, cards: [] },
    { key: "col-progress", title: "In Progress", position: 3, cards: [] },
    { key: "col-review", title: "Review", position: 4, cards: [] },
    { key: "col-done", title: "Done", position: 5, cards: [] },
  ],
};

const buildResponse = (payload: ApiBoard) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response);

describe("KanbanBoard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders five columns", () => {
    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column through backend api", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation((input) => {
      if (typeof input === "string" && input === "/api/columns/col-backlog") {
        return buildResponse({
          ...initialApiBoard,
          columns: initialApiBoard.columns.map((column) =>
            column.key === "col-backlog" ? { ...column, title: "New Name" } : column
          ),
        });
      }
      throw new Error("Unexpected request.");
    });

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);

    const firstColumn = screen.getByTestId("column-col-backlog");
    const input = within(firstColumn).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    await userEvent.tab();

    expect(await within(firstColumn).findByDisplayValue("New Name")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/columns/col-backlog",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("adds and removes a card through backend api", async () => {
    const addedBoard: ApiBoard = {
      ...initialApiBoard,
      columns: initialApiBoard.columns.map((column) =>
        column.key === "col-backlog"
          ? {
              ...column,
              cards: [
                ...column.cards,
                { id: 99, title: "New card", details: "Notes", position: 2 },
              ],
            }
          : column
      ),
    };

    const removedBoard: ApiBoard = {
      ...initialApiBoard,
      columns: initialApiBoard.columns.map((column) =>
        column.key === "col-backlog"
          ? {
              ...column,
              cards: [{ id: 1, title: "Card one", details: "Notes", position: 1 }],
            }
          : column
      ),
    };

    vi.spyOn(global, "fetch").mockImplementation((input, init) => {
      if (typeof input === "string" && input === "/api/cards" && init?.method === "POST") {
        return buildResponse(addedBoard);
      }
      if (typeof input === "string" && input === "/api/cards/99" && init?.method === "DELETE") {
        return buildResponse(removedBoard);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const column = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "New card");
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    expect(await within(column).findByText("New card")).toBeInTheDocument();

    await userEvent.click(within(column).getByRole("button", { name: /delete new card/i }));
    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("shows an error when a backend mutation fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Column title cannot be empty." }),
    } as Response);

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const firstColumn = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(firstColumn).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(firstColumn).getByPlaceholderText(/card title/i), "Failure card");
    await userEvent.click(within(firstColumn).getByRole("button", { name: /add card/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Column title cannot be empty."
    );
  });

  it("keeps the card editor open with the user's edits when saving fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Card title cannot be empty." }),
    } as Response);

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const column = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: "Edit Card one" }));
    const titleInput = within(column).getByLabelText("Edit title for Card one");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Unsaved title");
    await userEvent.click(within(column).getByRole("button", { name: "Save Card one" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Card title cannot be empty.");
    expect(within(column).getByLabelText("Edit title for Card one")).toHaveValue("Unsaved title");
  });

  it("keeps the new card form filled in when adding fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Column not found." }),
    } as Response);

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const column = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "Unsaved card");
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Unsaved details");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Column not found.");
    expect(within(column).getByPlaceholderText(/card title/i)).toHaveValue("Unsaved card");
    expect(within(column).getByPlaceholderText(/details/i)).toHaveValue("Unsaved details");
  });

  it("keeps the edited column title visible when renaming fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Column not found." }),
    } as Response);

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const column = screen.getByTestId("column-col-backlog");
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Unsaved name");
    await userEvent.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Column not found.");
    expect(within(column).getByLabelText("Column title")).toHaveValue("Unsaved name");
  });

  it("shows a friendly error when a mutation fails with a non-JSON response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("<!DOCTYPE html><html><body>Bad Gateway</body></html>", { status: 502 })
    );

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    const column = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "Gateway card");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to save that change right now. Please try again.");
    expect(alert).not.toHaveTextContent(/JSON|Unexpected token/);
  });

  it("shows a friendly chat error when the AI request fails with a non-JSON response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 })
    );

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    await userEvent.type(screen.getByLabelText("Prompt"), "Help");
    await userEvent.click(screen.getByRole("button", { name: "Send to AI" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to save that change right now. Please try again.");
    expect(alert).not.toHaveTextContent(/JSON|Unexpected token/);
  });

  it("queues AI-proposed updates until user confirms", async () => {
    const boardWithNewCard: ApiBoard = {
      ...initialApiBoard,
      columns: initialApiBoard.columns.map((column) =>
        column.key === "col-discovery"
          ? {
              ...column,
              cards: [
                ...column.cards,
                { id: 88, title: "AI card", details: "Created from chat", position: 1 },
              ],
            }
          : column
      ),
    };

    const fetchMock = vi.spyOn(global, "fetch").mockImplementation((input, init) => {
      if (typeof input === "string" && input === "/api/ai/chat") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            assistantMessage: "I can add that card for you.",
            proposedUpdates: [
              {
                action: "create_card",
                columnKey: "col-discovery",
                title: "AI card",
                details: "Created from chat",
              },
            ],
            chatHistory: [
              { role: "user", content: "Add a card in discovery" },
              { role: "assistant", content: "I can add that card for you." },
            ],
          }),
        } as Response);
      }
      if (typeof input === "string" && input === "/api/cards" && init?.method === "POST") {
        return buildResponse(boardWithNewCard);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);

    await userEvent.type(screen.getByLabelText("Prompt"), "Add a card in discovery");
    await userEvent.click(screen.getByRole("button", { name: "Send to AI" }));

    expect(await screen.findByText('Create card "AI card" in "Discovery"')).toBeInTheDocument();
    const targetColumn = screen.getByTestId("column-col-discovery");
    expect(within(targetColumn).queryByText("AI card")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await within(targetColumn).findByText("AI card")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("describes AI-proposed updates with card and column titles, not ids", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      if (typeof input === "string" && input === "/api/ai/chat") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            assistantMessage: "Here are some changes.",
            proposedUpdates: [
              { action: "rename_column", columnKey: "col-backlog", title: "Ideas" },
              { action: "update_card", cardId: 1, title: "Card renamed" },
              { action: "move_card", cardId: 1, targetColumnKey: "col-review", targetPosition: 1 },
              { action: "delete_card", cardId: 1 },
            ],
            chatHistory: [],
          }),
        } as Response);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(<KanbanBoard initialBoard={toBoardData(initialApiBoard)} />);
    await userEvent.type(screen.getByLabelText("Prompt"), "Tidy up");
    await userEvent.click(screen.getByRole("button", { name: "Send to AI" }));

    const pending = await screen.findByTestId("ai-pending-updates");
    expect(await within(pending).findByText('Rename column "Backlog" to "Ideas"')).toBeInTheDocument();
    expect(within(pending).getByText('Update card "Card one" (title)')).toBeInTheDocument();
    expect(within(pending).getByText('Move card "Card one" to "Review"')).toBeInTheDocument();
    expect(within(pending).getByText('Delete card "Card one"')).toBeInTheDocument();
    expect(pending).not.toHaveTextContent(/#1|col-/);
  });
});
