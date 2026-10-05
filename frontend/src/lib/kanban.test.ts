import {
  deriveMoveTargetPosition,
  findColumnKeyByDndId,
  parseCardIdFromDndId,
  toBoardData,
  type ApiBoard,
} from "@/lib/kanban";

describe("kanban mapping helpers", () => {
  const apiBoard: ApiBoard = {
    boardId: 1,
    userId: 1,
    title: "Kanban Board",
    columns: [
      {
        key: "col-backlog",
        title: "Backlog",
        position: 1,
        cards: [
          { id: 2, title: "Second", details: "b", position: 2 },
          { id: 1, title: "First", details: "a", position: 1 },
        ],
      },
      {
        key: "col-review",
        title: "Review",
        position: 2,
        cards: [],
      },
    ],
  };

  it("normalizes api board to UI state", () => {
    const board = toBoardData(apiBoard);
    expect(board.columns[0].cardIds).toEqual(["card-1", "card-2"]);
    expect(board.cards["card-1"].title).toBe("First");
  });

  it("parses card numeric id from dnd id", () => {
    expect(parseCardIdFromDndId("card-42")).toBe(42);
    expect(parseCardIdFromDndId("col-backlog")).toBeNull();
  });

  it("finds target column key from a card or column drag target", () => {
    const board = toBoardData(apiBoard);
    expect(findColumnKeyByDndId(board.columns, "card-1")).toBe("col-backlog");
    expect(findColumnKeyByDndId(board.columns, "col-review")).toBe("col-review");
  });

  it("derives insertion position before or after hovered card across columns", () => {
    const board = toBoardData({
      ...apiBoard,
      columns: [
        {
          key: "col-backlog",
          title: "Backlog",
          position: 1,
          cards: [
            { id: 1, title: "First", details: "a", position: 1 },
            { id: 2, title: "Second", details: "b", position: 2 },
          ],
        },
        {
          key: "col-review",
          title: "Review",
          position: 2,
          cards: [
            { id: 3, title: "Review A", details: "r", position: 1 },
            { id: 4, title: "Review B", details: "s", position: 2 },
          ],
        },
      ],
    });

    expect(
      deriveMoveTargetPosition({
        columns: board.columns,
        sourceColumnKey: "col-backlog",
        targetColumnKey: "col-review",
        activeCardDndId: "card-1",
        overDndId: "card-4",
        dropAfterOverCard: false,
      })
    ).toBe(2);
    expect(
      deriveMoveTargetPosition({
        columns: board.columns,
        sourceColumnKey: "col-backlog",
        targetColumnKey: "col-review",
        activeCardDndId: "card-1",
        overDndId: "card-4",
        dropAfterOverCard: true,
      })
    ).toBe(3);
  });

  it("derives insertion position for same-column move with index shift", () => {
    const board = toBoardData({
      ...apiBoard,
      columns: [
        {
          key: "col-backlog",
          title: "Backlog",
          position: 1,
          cards: [
            { id: 1, title: "First", details: "a", position: 1 },
            { id: 2, title: "Second", details: "b", position: 2 },
            { id: 5, title: "Third", details: "c", position: 3 },
          ],
        },
        {
          key: "col-review",
          title: "Review",
          position: 2,
          cards: [],
        },
      ],
    });

    expect(
      deriveMoveTargetPosition({
        columns: board.columns,
        sourceColumnKey: "col-backlog",
        targetColumnKey: "col-backlog",
        activeCardDndId: "card-1",
        overDndId: "card-5",
        dropAfterOverCard: false,
      })
    ).toBe(2);
    expect(
      deriveMoveTargetPosition({
        columns: board.columns,
        sourceColumnKey: "col-backlog",
        targetColumnKey: "col-backlog",
        activeCardDndId: "card-1",
        overDndId: "card-5",
        dropAfterOverCard: true,
      })
    ).toBe(3);
  });
});
