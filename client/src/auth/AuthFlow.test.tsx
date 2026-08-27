import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";

const csrfToken = "c".repeat(43);
const authenticatedSession = {
  authenticated: true,
  account: { username: "TEST_USER" },
  csrfToken
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input, "http://portal.test").pathname;
  }
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function renderApp(path: string, fetchImplementation: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(fetchImplementation));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  });
  const router = createMemoryRouter(
    [{ path: "*", element: <App /> }],
    { initialEntries: [path] }
  );
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
    queryClient,
    router
  };
}

function publicFallback(input: RequestInfo | URL): Promise<Response> {
  const path = pathOf(input);
  if (path === "/api/status") {
    return Promise.resolve(jsonResponse({ online: true }));
  }
  if (path === "/api/online-players") {
    return Promise.resolve(jsonResponse({
      generatedAt: "2026-08-26T12:00:00.000Z",
      count: 0,
      players: []
    }));
  }
  return Promise.resolve(jsonResponse({ error: "Not found." }, 404));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portal authentication experience", () => {
  it("does not flash protected content and safely redirects a signed-out visitor", async () => {
    let resolveSession!: (response: Response) => void;
    const pendingSession = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    const { router } = renderApp("/boosts", (input) =>
      pathOf(input) === "/api/auth/session"
        ? pendingSession
        : publicFallback(input)
    );

    expect(screen.getByText("Checking your portal session...")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Boosts" })).toBeNull();
    resolveSession(jsonResponse({ authenticated: false }));

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?returnTo=%2Fboosts");
  });

  it("shows a generic login error, retains the account name, and clears the password", async () => {
    renderApp("/login?returnTo=/boosts", (input) => {
      const path = pathOf(input);
      if (path === "/api/auth/session") {
        return Promise.resolve(jsonResponse({ authenticated: false }));
      }
      if (path === "/api/auth/login") {
        return Promise.resolve(jsonResponse({
          error: "The account name or password is incorrect."
        }, 401));
      }
      return publicFallback(input);
    });
    const user = userEvent.setup();
    const username = await screen.findByLabelText<HTMLInputElement>("Account name");
    const password = screen.getByLabelText<HTMLInputElement>("Password");
    await user.type(username, "test_user");
    await user.type(password, "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("The account name or password is incorrect.")).toBeTruthy();
    expect(username.value).toBe("test_user");
    expect(password.value).toBe("");
    expect(username.getAttribute("autocomplete")).toBe("username");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  it("returns to the protected route after login and shows the canonical account", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = pathOf(input);
      if (path === "/api/auth/session") {
        return Promise.resolve(jsonResponse({ authenticated: false }));
      }
      if (path === "/api/auth/login") {
        return Promise.resolve(jsonResponse(authenticatedSession));
      }
      return publicFallback(input);
    });
    const { router } = renderApp("/login?returnTo=/boosts", fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Account name"), "test_user");
    await user.type(screen.getByLabelText("Password"), "fabricated-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Boosts" })).toBeTruthy();
    expect(screen.getByText("TEST_USER")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/boosts");
    const loginCall = fetchMock.mock.calls.find(([input]) => pathOf(input) === "/api/auth/login");
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      username: "test_user",
      password: "fabricated-password"
    });
  });

  it("rejects an external return target", async () => {
    const { router } = renderApp("/login?returnTo=https://evil.example", (input) => {
      const path = pathOf(input);
      if (path === "/api/auth/session") {
        return Promise.resolve(jsonResponse({ authenticated: false }));
      }
      if (path === "/api/auth/login") {
        return Promise.resolve(jsonResponse(authenticatedSession));
      }
      return publicFallback(input);
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Account name"), "test_user");
    await user.type(screen.getByLabelText("Password"), "fabricated-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.pathname).not.toContain("evil");
  });

  it("logs out with the in-memory CSRF token and clears protected state", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = pathOf(input);
      if (path === "/api/auth/session") {
        return Promise.resolve(jsonResponse(authenticatedSession));
      }
      if (path === "/api/auth/logout") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return publicFallback(input);
    });
    const { router } = renderApp("/boosts", fetchMock);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { level: 1, name: "Boosts" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    const logoutCall = fetchMock.mock.calls.find(([input]) => pathOf(input) === "/api/auth/logout");
    expect(new Headers(logoutCall?.[1]?.headers).get("X-CSRF-Token")).toBe(csrfToken);
  });
});
