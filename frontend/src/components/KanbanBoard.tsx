"use client";

import { useMemo, useRef, useState } from "react";
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import {
  AiChatSidebar,
  type ChatMessage,
  type PendingUpdate,
  type ProposedUpdate,
} from "@/components/AiChatSidebar";
import { readErrorMessage } from "@/lib/api";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import {
  findColumnKeyByDndId,
  parseCardIdFromDndId,
  toBoardData,
  type BoardData,
} from "@/lib/kanban";

const defaultError = "Unable to save that change right now. Please try again.";

type KanbanBoardProps = {
  initialBoard: BoardData;
  initialChatHistory?: ChatMessage[];
};

type AIChatResponse = {
  assistantMessage: string;
  proposedUpdates: ProposedUpdate[];
  chatHistory: ChatMessage[];
};

const fallbackCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCorners(args);
};

const createCollisionDetectionStrategy = (columnKeys: Set<string>): CollisionDetection => {
  return (args: Parameters<CollisionDetection>[0]) => {
    const filteredArgs = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => container.id !== args.active.id
      ),
    };

    const pointerCollisions = pointerWithin(filteredArgs);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    const columnContainers = filteredArgs.droppableContainers.filter((container) =>
      columnKeys.has(String(container.id))
    );
    if (columnContainers.length > 0) {
      const columnCollisions = rectIntersection({
        ...filteredArgs,
        droppableContainers: columnContainers,
      });
      if (columnCollisions.length > 0) {
        return columnCollisions;
      }
    }

    return fallbackCollisionDetection(filteredArgs);
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// Current pointer position in viewport coordinates. active.rect describes the
// 260px DragOverlay rather than the card, so its center is not the pointer.
const getPointerPosition = (event: DragMoveEvent | DragEndEvent) => {
  const start = getEventCoordinates(event.activatorEvent);
  return start ? { x: start.x + event.delta.x, y: start.y + event.delta.y } : null;
};

const resolveColumnKeyFromViewportPoint = (x: number, y: number): string | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const columns = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="column-"]')
  );
  if (columns.length === 0) {
    return null;
  }

  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const testId = column.dataset.testid ?? "";
      if (testId.startsWith("column-")) {
        return testId.slice("column-".length);
      }
    }
  }

  let closestKey: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const distance = Math.abs(centerX - x);
    if (distance < closestDistance) {
      closestDistance = distance;
      const testId = column.dataset.testid ?? "";
      closestKey = testId.startsWith("column-") ? testId.slice("column-".length) : null;
    }
  }

  return closestKey;
};

const resolveColumnKeyFromHorizontalDelta = (
  columns: BoardData["columns"],
  sourceColumnKey: string,
  deltaX: number
): string | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const sourceIndex = columns.findIndex((column) => column.key === sourceColumnKey);
  if (sourceIndex < 0) {
    return null;
  }

  const sourceColumnElement = document.querySelector<HTMLElement>(
    `[data-testid="column-${sourceColumnKey}"]`
  );
  const sourceWidth = sourceColumnElement?.getBoundingClientRect().width ?? 220;
  const shiftStep = Math.max(sourceWidth * 0.6, 120);
  const shift = Math.round(deltaX / shiftStep);
  if (shift === 0) {
    return null;
  }

  const targetIndex = clamp(sourceIndex + shift, 0, columns.length - 1);
  if (targetIndex === sourceIndex) {
    return null;
  }
  return columns[targetIndex].key;
};

const deriveTargetPositionFromPointer = (
  columns: BoardData["columns"],
  sourceColumnKey: string,
  targetColumnKey: string,
  activeCardDndId: string,
  pointerY: number | null,
  overDndId: string
): number | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const targetColumn = columns.find((column) => column.key === targetColumnKey);
  if (!targetColumn) {
    return null;
  }

  const orderedCardIds = targetColumn.cardIds.filter((cardId) => cardId !== activeCardDndId);
  if (orderedCardIds.length === 0) {
    return 1;
  }

  if (sourceColumnKey === targetColumnKey) {
    const targetIdsWithActive = targetColumn.cardIds;
    const sourceIndex = targetIdsWithActive.indexOf(activeCardDndId);
    const overIndex = targetIdsWithActive.indexOf(overDndId);
    if (sourceIndex >= 0 && overIndex >= 0 && sourceIndex !== overIndex) {
      const movingDownward = sourceIndex < overIndex;
      const destinationIndex = movingDownward ? overIndex : overIndex;
      return clamp(destinationIndex + 1, 1, targetIdsWithActive.length);
    }
  }

  if (overDndId !== targetColumnKey) {
    const overIndex = orderedCardIds.indexOf(overDndId);
    if (overIndex >= 0) {
      const overCardElement = document.querySelector<HTMLElement>(`[data-testid="${overDndId}"]`);
      if (pointerY !== null && overCardElement) {
        const overRect = overCardElement.getBoundingClientRect();
        const overMidpoint = overRect.top + overRect.height / 2;
        const indexAfterOrBefore = pointerY > overMidpoint ? overIndex + 1 : overIndex;
        return clamp(indexAfterOrBefore + 1, 1, orderedCardIds.length + 1);
      }
      return overIndex + 1;
    }
  }

  if (pointerY === null) {
    return null;
  }

  let insertIndex = 0;
  for (const cardDndId of orderedCardIds) {
    const cardElement = document.querySelector<HTMLElement>(`[data-testid="${cardDndId}"]`);
    if (!cardElement) {
      continue;
    }
    const cardRect = cardElement.getBoundingClientRect();
    const cardMidpoint = cardRect.top + cardRect.height / 2;
    if (pointerY > cardMidpoint) {
      insertIndex += 1;
    }
  }

  return insertIndex + 1;
};

export const KanbanBoard = ({ initialBoard, initialChatHistory = [] }: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialChatHistory);
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdate[]>([]);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [applyingUpdateId, setApplyingUpdateId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const lastKnownOverIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  const cardsById = useMemo(() => board.cards, [board.cards]);
  const collisionDetectionStrategy = useMemo(
    () => createCollisionDetectionStrategy(new Set(board.columns.map((column) => column.key))),
    [board.columns]
  );

  const applyBoardResponse = (payload: unknown) => {
    setBoard(toBoardData(payload as Parameters<typeof toBoardData>[0]));
  };

  const withPersistence = async (action: () => Promise<Response>) => {
    setError(null);
    setIsSaving(true);
    try {
      const response = await action();
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, defaultError));
      }
      const payload = (await response.json()) as unknown;
      applyBoardResponse(payload);
      return true;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : defaultError
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const applyProposedUpdate = async (instruction: ProposedUpdate) => {
    if (instruction.action === "rename_column") {
      return withPersistence(() =>
        fetch(`/api/columns/${instruction.columnKey}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: instruction.title }),
        })
      );
    }
    if (instruction.action === "create_card") {
      return withPersistence(() =>
        fetch("/api/cards", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            columnKey: instruction.columnKey,
            title: instruction.title,
            details: instruction.details,
          }),
        })
      );
    }
    if (instruction.action === "update_card") {
      return withPersistence(() =>
        fetch(`/api/cards/${instruction.cardId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: instruction.title,
            details: instruction.details,
          }),
        })
      );
    }
    if (instruction.action === "delete_card") {
      return withPersistence(() =>
        fetch(`/api/cards/${instruction.cardId}`, {
          method: "DELETE",
          credentials: "include",
        })
      );
    }

    return withPersistence(() =>
      fetch(`/api/cards/${instruction.cardId}/move`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetColumnKey: instruction.targetColumnKey,
          targetPosition: instruction.targetPosition,
        }),
      })
    );
  };

  const handleSubmitPrompt = async (prompt: string) => {
    setChatError(null);
    setIsSubmittingPrompt(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, defaultError));
      }
      const payload = (await response.json()) as AIChatResponse;
      setChatHistory(payload.chatHistory);
      if (payload.proposedUpdates.length > 0) {
        const responseTimestamp = Date.now();
        setPendingUpdates((existing) => [
          ...existing,
          ...payload.proposedUpdates.map((instruction, index) => ({
            id: `${responseTimestamp}-${index}`,
            instruction,
          })),
        ]);
      }
    } catch (caughtError) {
      setChatError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : defaultError
      );
    } finally {
      setIsSubmittingPrompt(false);
    }
  };

  const handleConfirmUpdate = async (pendingId: string) => {
    const update = pendingUpdates.find((pending) => pending.id === pendingId);
    if (!update) {
      return;
    }
    setApplyingUpdateId(pendingId);
    const wasApplied = await applyProposedUpdate(update.instruction);
    if (wasApplied) {
      setPendingUpdates((existing) => existing.filter((pending) => pending.id !== pendingId));
    }
    setApplyingUpdateId(null);
  };

  const handleRejectUpdate = (pendingId: string) => {
    setPendingUpdates((existing) => existing.filter((pending) => pending.id !== pendingId));
  };

  const handleDragStart = (event: DragStartEvent) => {
    lastKnownOverIdRef.current = null;
    setActiveCardId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (event.over?.id) {
      lastKnownOverIdRef.current = String(event.over.id);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const pointer = getPointerPosition(event);
    if (pointer === null) {
      return;
    }
    const columnKey = resolveColumnKeyFromViewportPoint(pointer.x, pointer.y);
    if (columnKey) {
      lastKnownOverIdRef.current = columnKey;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    const activeDndId = active.id as string;
    const pointer = getPointerPosition(event);
    const pointerCenterY = pointer?.y ?? null;
    const pointerColumnKey = pointer
      ? resolveColumnKeyFromViewportPoint(pointer.x, pointer.y)
      : null;
    const rememberedOverId =
      lastKnownOverIdRef.current && lastKnownOverIdRef.current !== activeDndId
        ? lastKnownOverIdRef.current
        : null;
    lastKnownOverIdRef.current = null;

    if (!over && !pointerColumnKey) {
      return;
    }

    const collisionFallbackId =
      event.collisions
        ?.map((collision) => String(collision.id))
        .find((collisionId) => collisionId !== activeDndId) ?? null;
    const overDndId =
      pointerColumnKey ??
      rememberedOverId ??
      (over && over.id !== active.id ? (over.id as string) : collisionFallbackId);
    if (!overDndId) {
      return;
    }

    const cardId = parseCardIdFromDndId(activeDndId);
    if (cardId === null) {
      return;
    }

    const sourceColumnKey = findColumnKeyByDndId(board.columns, activeDndId);
    if (!sourceColumnKey) {
      return;
    }
    let targetColumnKey = pointerColumnKey ?? findColumnKeyByDndId(board.columns, overDndId);
    if (!targetColumnKey) {
      return;
    }
    // Only infer a column from horizontal drag distance when the pointer is not
    // over any column; a pointer inside the source column means a reorder.
    if (!pointerColumnKey && targetColumnKey === sourceColumnKey) {
      const deltaDerivedColumnKey = resolveColumnKeyFromHorizontalDelta(
        board.columns,
        sourceColumnKey,
        event.delta.x
      );
      if (deltaDerivedColumnKey) {
        targetColumnKey = deltaDerivedColumnKey;
      }
    }

    const targetPosition = deriveTargetPositionFromPointer(
      board.columns,
      sourceColumnKey,
      targetColumnKey,
      activeDndId,
      pointerCenterY,
      overDndId
    );

    await withPersistence(() =>
      fetch(`/api/cards/${cardId}/move`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetColumnKey,
          targetPosition,
        }),
      })
    );
  };

  const handleRenameColumn = async (columnKey: string, title: string) => {
    return withPersistence(() =>
      fetch(`/api/columns/${columnKey}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
    );
  };

  const handleAddCard = async (columnKey: string, title: string, details: string) => {
    return withPersistence(() =>
      fetch("/api/cards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnKey, title, details }),
      })
    );
  };

  const handleDeleteCard = async (cardDndId: string) => {
    const cardId = parseCardIdFromDndId(cardDndId);
    if (cardId === null) {
      return;
    }
    await withPersistence(() =>
      fetch(`/api/cards/${cardId}`, {
        method: "DELETE",
        credentials: "include",
      })
    );
  };

  const handleUpdateCard = async (cardDndId: string, title: string, details: string) => {
    const cardId = parseCardIdFromDndId(cardDndId);
    if (cardId === null) {
      return false;
    }
    return withPersistence(() =>
      fetch(`/api/cards/${cardId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, details }),
      })
    );
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                Focus
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                One board. Five columns. Zero clutter.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.key}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
          {isSaving ? (
            <p className="text-sm font-medium text-[var(--gray-text)]">Saving changes...</p>
          ) : null}
          {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragCancel={() => {
              lastKnownOverIdRef.current = null;
              setActiveCardId(null);
            }}
            onDragEnd={(event) => {
              void handleDragEnd(event);
            }}
          >
            <section className="grid gap-6 lg:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.key}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                  onUpdateCard={handleUpdateCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <AiChatSidebar
            board={board}
            chatHistory={chatHistory}
            pendingUpdates={pendingUpdates}
            isSubmittingPrompt={isSubmittingPrompt}
            applyingUpdateId={applyingUpdateId}
            error={chatError}
            onSubmitPrompt={handleSubmitPrompt}
            onConfirmUpdate={handleConfirmUpdate}
            onRejectUpdate={handleRejectUpdate}
          />
        </div>
      </main>
    </div>
  );
};
