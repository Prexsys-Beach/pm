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
});
