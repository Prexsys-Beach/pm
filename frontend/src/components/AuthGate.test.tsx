import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "@/components/AuthGate";

type MockResponse = {
  ok: boolean;
  body: unknown;
};

const buildJsonResponse = ({ ok, body }: MockResponse) =>
  Promise.resolve({
    ok,
    json: async () => body,
  } as Response);

const boardPayload = {
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

describe("AuthGate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows login form when session is unauthenticated", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return buildJsonResponse({
          ok: true,
          body: { authenticated: false, username: null },
        });
      }
      throw new Error("Unexpected request.");
    });

    render(<AuthGate />);

    expect(await screen.findByRole("heading", { name: /sign in to continue/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("signs in with valid credentials and displays the board", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockImplementation((input, init) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return buildJsonResponse({
          ok: true,
          body: { authenticated: false, username: null },
        });
      }
      if (typeof input === "string" && input === "/api/auth/login") {
        expect(init?.method).toBe("POST");
        return buildJsonResponse({
          ok: true,
          body: { authenticated: true, username: "user" },
        });
      }
      if (typeof input === "string" && input === "/api/board") {
        return buildJsonResponse({ ok: true, body: boardPayload });
      }
      throw new Error("Unexpected request.");
    });

    render(<AuthGate />);

    await userEvent.type(await screen.findByLabelText(/username/i), "user");
    await userEvent.type(screen.getByLabelText(/password/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /kanban studio/i })).toBeInTheDocument();
  });

  it("logs out and returns to login form", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    let authenticated = true;
    fetchMock.mockImplementation((input) => {
      if (typeof input === "string" && input === "/api/auth/session") {
        return buildJsonResponse({
          ok: true,
          body: { authenticated, username: authenticated ? "user" : null },
        });
      }
      if (typeof input === "string" && input === "/api/board") {
        return buildJsonResponse({ ok: true, body: boardPayload });
      }
      if (typeof input === "string" && input === "/api/auth/logout") {
        authenticated = false;
        return buildJsonResponse({
          ok: true,
          body: { authenticated: false },
        });
      }
      throw new Error("Unexpected request.");
    });

    render(<AuthGate />);

    await screen.findByText(/signed in as/i);
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /sign in to continue/i })).toBeInTheDocument();
    });
  });
});
