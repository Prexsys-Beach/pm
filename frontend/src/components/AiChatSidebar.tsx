"use client";

import { FormEvent, useState } from "react";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ProposedUpdate =
  | { action: "rename_column"; columnKey: string; title: string }
  | { action: "create_card"; columnKey: string; title: string; details: string }
  | { action: "update_card"; cardId: number; title?: string; details?: string }
  | { action: "delete_card"; cardId: number }
  | {
      action: "move_card";
      cardId: number;
      targetColumnKey: string;
      targetPosition: number | null;
    };

export type PendingUpdate = {
  id: string;
  instruction: ProposedUpdate;
};

type AiChatSidebarProps = {
  chatHistory: ChatMessage[];
  pendingUpdates: PendingUpdate[];
  isSubmittingPrompt: boolean;
  applyingUpdateId: string | null;
  error: string | null;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onConfirmUpdate: (id: string) => Promise<void>;
  onRejectUpdate: (id: string) => void;
};

const describeUpdate = (update: ProposedUpdate): string => {
  if (update.action === "rename_column") {
    return `Rename ${update.columnKey} to "${update.title}"`;
  }
  if (update.action === "create_card") {
    return `Create card "${update.title}" in ${update.columnKey}`;
  }
  if (update.action === "update_card") {
    const updates: string[] = [];
    if (typeof update.title === "string") {
      updates.push("title");
    }
    if (typeof update.details === "string") {
      updates.push("details");
    }
    return `Update card #${update.cardId} (${updates.join(" and ")})`;
  }
  if (update.action === "delete_card") {
    return `Delete card #${update.cardId}`;
  }
  return `Move card #${update.cardId} to ${update.targetColumnKey}`;
};

export const AiChatSidebar = ({
  chatHistory,
  pendingUpdates,
  isSubmittingPrompt,
  applyingUpdateId,
  error,
  onSubmitPrompt,
  onConfirmUpdate,
  onRejectUpdate,
}: AiChatSidebarProps) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedPrompt = prompt.trim();
    if (!cleanedPrompt) {
      return;
    }
    await onSubmitPrompt(cleanedPrompt);
    setPrompt("");
  };

  return (
    <aside className="rounded-3xl border border-[var(--stroke)] bg-white/85 p-5 shadow-[var(--shadow)] backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
            AI Assistant
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold text-[var(--navy-dark)]">
            Board chat
          </h2>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-[var(--gray-text)]">
        Proposed board changes require your confirmation before anything is applied.
      </p>

      <div
        className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-3"
        data-testid="ai-chat-thread"
      >
        {chatHistory.length === 0 ? (
          <p className="text-sm text-[var(--gray-text)]">
            Ask for planning help or card edits to get started.
          </p>
        ) : (
          chatHistory.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className="rounded-xl border border-[var(--stroke)] bg-white p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                {message.role}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--navy-dark)]">
                {message.content}
              </p>
            </article>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-[var(--navy-dark)]">
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="Example: Move the API testing card to Review."
            className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmittingPrompt}
          className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isSubmittingPrompt ? "Sending..." : "Send to AI"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--gray-text)]">
          Pending updates
        </h3>
        <div className="mt-3 space-y-3" data-testid="ai-pending-updates">
          {pendingUpdates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--stroke)] px-3 py-4 text-sm text-[var(--gray-text)]">
              No pending updates.
            </p>
          ) : (
            pendingUpdates.map((pending) => (
              <article key={pending.id} className="rounded-xl border border-[var(--stroke)] bg-white p-3">
                <p className="text-sm font-medium text-[var(--navy-dark)]">
                  {describeUpdate(pending.instruction)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onConfirmUpdate(pending.id);
                    }}
                    disabled={applyingUpdateId === pending.id}
                    className="flex-1 rounded-full bg-[var(--primary-blue)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {applyingUpdateId === pending.id ? "Applying..." : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectUpdate(pending.id)}
                    disabled={applyingUpdateId === pending.id}
                    className="flex-1 rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)] disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
