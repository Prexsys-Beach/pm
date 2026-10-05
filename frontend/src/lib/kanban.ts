export type Card = {
  id: number;
  dndId: string;
  title: string;
  details: string;
  position: number;
};

export type Column = {
  key: string;
  title: string;
  position: number;
  cardIds: string[];
};

export type BoardData = {
  boardId: number;
  userId: number;
  title: string;
  columns: Column[];
  cards: Record<string, Card>;
};

export type ApiCard = {
  id: number;
  title: string;
  details: string;
  position: number;
};

export type ApiColumn = {
  key: string;
  title: string;
  position: number;
  cards: ApiCard[];
};

export type ApiBoard = {
  boardId: number;
  userId: number;
  title: string;
  columns: ApiColumn[];
};

export const toDndCardId = (id: number) => `card-${id}`;

export const toBoardData = (board: ApiBoard): BoardData => {
  const cards: Record<string, Card> = {};
  const columns = board.columns
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((column) => {
      const orderedCards = column.cards.slice().sort((a, b) => a.position - b.position);
      const cardIds = orderedCards.map((card) => {
        const dndId = toDndCardId(card.id);
        cards[dndId] = {
          id: card.id,
          dndId,
          title: card.title,
          details: card.details,
          position: card.position,
        };
        return dndId;
      });

      return {
        key: column.key,
        title: column.title,
        position: column.position,
        cardIds,
      };
    });

  return {
    boardId: board.boardId,
    userId: board.userId,
    title: board.title,
    columns,
    cards,
  };
};

export const parseCardIdFromDndId = (dndId: string): number | null => {
  if (!dndId.startsWith("card-")) {
    return null;
  }
  const numericPart = Number.parseInt(dndId.slice("card-".length), 10);
  if (Number.isNaN(numericPart)) {
    return null;
  }
  return numericPart;
};

export const findColumnKeyByDndId = (columns: Column[], dndId: string): string | null => {
  if (columns.some((column) => column.key === dndId)) {
    return dndId;
  }
  return columns.find((column) => column.cardIds.includes(dndId))?.key ?? null;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const deriveMoveTargetPosition = ({
  columns,
  sourceColumnKey,
  targetColumnKey,
  activeCardDndId,
  overDndId,
  dropAfterOverCard,
}: {
  columns: Column[];
  sourceColumnKey: string;
  targetColumnKey: string;
  activeCardDndId: string;
  overDndId: string;
  dropAfterOverCard: boolean;
}): number | null => {
  if (overDndId === targetColumnKey) {
    return null;
  }

  const targetColumn = columns.find((column) => column.key === targetColumnKey);
  if (!targetColumn) {
    return null;
  }

  const overIndex = targetColumn.cardIds.indexOf(overDndId);
  if (overIndex < 0) {
    return null;
  }

  if (sourceColumnKey !== targetColumnKey) {
    const destinationCount = targetColumn.cardIds.length;
    const insertIndex = clamp(overIndex + (dropAfterOverCard ? 1 : 0), 0, destinationCount);
    return insertIndex + 1;
  }

  const sourceIndex = targetColumn.cardIds.indexOf(activeCardDndId);
  if (sourceIndex < 0) {
    return null;
  }

  let insertIndex = overIndex + (dropAfterOverCard ? 1 : 0);
  if (insertIndex > sourceIndex) {
    insertIndex -= 1;
  }
  insertIndex = clamp(insertIndex, 0, targetColumn.cardIds.length - 1);
  return insertIndex + 1;
};
