"use client";

import { FormEvent, useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { toBoardData, type BoardData } from "@/lib/kanban";

type SessionResponse = {
  authenticated: boolean;
  username: string | null;
};

const defaultError = "Unable to complete that action right now. Please try again.";

export const AuthGate = () => {
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBoard = async () => {
    setIsLoadingBoard(true);
    try {
      const response = await fetch("/api/board", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string };
        throw new Error(payload.detail ?? defaultError);
      }
      const payload = await response.json();
      setBoard(toBoardData(payload));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : defaultError
      );
      setIsAuthenticated(false);
      setBoard(null);
    } finally {
      setIsLoadingBoard(false);
    }
  };

  const loadSession = async () => {
    setIsLoadingSession(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Unable to load session.");
      }
      const session = (await response.json()) as SessionResponse;
      setIsAuthenticated(session.authenticated);
      if (session.authenticated) {
        await loadBoard();
      }
    } catch {
      setError(defaultError);
      setIsAuthenticated(false);
      setBoard(null);
    } finally {
      setIsLoadingSession(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string };
        throw new Error(payload.detail ?? defaultError);
      }
      setPassword("");
      setIsAuthenticated(true);
      await loadBoard();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : defaultError
      );
      setIsAuthenticated(false);
      setBoard(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(defaultError);
      }
      setIsAuthenticated(false);
      setUsername("");
      setPassword("");
      setBoard(null);
    } catch {
      setError(defaultError);
    }
  };

  if (isLoadingSession) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[460px] items-center px-6 py-10">
        <div className="w-full rounded-3xl border border-[var(--stroke)] bg-white p-8 text-center shadow-[var(--shadow)]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Checking session
          </p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[460px] items-center px-6 py-10">
        <div className="w-full rounded-3xl border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            PM MVP
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Sign in to continue
          </h1>
          <p className="mt-2 text-sm text-[var(--gray-text)]">
            Use username <strong>user</strong> and password <strong>password</strong>.
          </p>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
                required
              />
            </label>
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm outline-none focus:border-[var(--primary-blue)]"
                required
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (isLoadingBoard || !board) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[460px] items-center px-6 py-10">
        <div className="w-full rounded-3xl border border-[var(--stroke)] bg-white p-8 text-center shadow-[var(--shadow)]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Loading board
          </p>
        </div>
      </main>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-[var(--stroke)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-3">
          <p className="text-sm font-medium text-[var(--gray-text)]">
            Signed in as <span className="font-semibold text-[var(--navy-dark)]">user</span>
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
          >
            Log out
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mx-auto mt-4 max-w-[1500px] px-6 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <KanbanBoard initialBoard={board} />
    </div>
  );
};
