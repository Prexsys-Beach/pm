import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => Promise<void>;
  onUpdate: (cardId: string, title: string, details: string) => Promise<void>;
};

export const KanbanCard = ({ card, onDelete, onUpdate }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [detailsDraft, setDetailsDraft] = useState(card.details);
  const [isSaving, setIsSaving] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.dndId,
      disabled: { droppable: true },
    });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startEditing = () => {
    setTitleDraft(card.title);
    setDetailsDraft(card.details);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setTitleDraft(card.title);
    setDetailsDraft(card.details);
    setIsEditing(false);
  };

  const saveCard = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      return;
    }
    setIsSaving(true);
    try {
      await onUpdate(card.dndId, nextTitle, detailsDraft.trim());
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...attributes}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {isEditing ? (
            <div className="space-y-2">
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                className="w-full rounded-lg border border-[var(--stroke)] px-2 py-1 text-sm font-semibold text-[var(--navy-dark)] outline-none"
                aria-label={`Edit title for ${card.title}`}
              />
              <textarea
                value={detailsDraft}
                onChange={(event) => setDetailsDraft(event.target.value)}
                className="w-full resize-none rounded-lg border border-[var(--stroke)] px-2 py-1 text-sm text-[var(--gray-text)] outline-none"
                rows={3}
                aria-label={`Edit details for ${card.title}`}
              />
            </div>
          ) : (
            <>
              <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
                {card.title}
              </h4>
              <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
                {card.details}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={saveCard}
                disabled={isSaving}
                className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--primary-blue)] transition hover:border-[var(--stroke)] disabled:opacity-60"
                aria-label={`Save ${card.title}`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
                aria-label={`Cancel editing ${card.title}`}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
                aria-label={`Edit ${card.title}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void onDelete(card.dndId)}
                className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
                aria-label={`Delete ${card.title}`}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};
